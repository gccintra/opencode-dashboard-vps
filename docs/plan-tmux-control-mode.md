# Plan — Replace node-pty with tmux control mode

Status: PROPOSED (PoC first)
Author: session 2026-06-21
Related: `docs/plan-tmux-backed-sessions.md` (the tmux migration this builds on)

---

## 1. Why

The pty-worker periodically wedges at ~100% CPU and stops serving (new sessions
born dead). Root cause is **not our logic** — it is a node-pty 1.1.0 Linux bug:
when a PTY master fd hangs up, node-pty fails to close it, libuv spins on
`read()=EAGAIN` forever. Confirmed by strace (`/dev/ptmx` fd in infinite EAGAIN;
closed fds stuck in the epoll set = a dup'd master leaked by node-pty).

Current mitigations are band-aids: in-worker JS watchdog (can't fire when the
loop is C-pegged), server-side `/proc` CPU monitor that SIGKILLs + respawns, and
WS-level reattach. They recover from the wedge; they don't prevent it.

**Key realization:** node-pty is now *vestigial*. Before the tmux migration the
worker ran claude/opencode directly in a node-pty PTY, so a real tty was
mandatory. After tmux, the **tmux daemon owns the real PTY** for the inner
process; node-pty only gives a tty to the `tmux attach` *client*. That last PTY
is the only thing that wedges.

`tmux` has **control mode** (`tmux -C`), designed for programmatic clients
(iTerm2 uses it): the client talks to tmux over **stdin/stdout pipes, no PTY**.
No PTY → no node-pty → the entire bug class disappears, and the stack shrinks
(drop node-pty, Node 18, pty-sighup-exec, and possibly the separate worker).

---

## 2. Verified control-mode facts (tmux 3.4, on host)

Attach in control mode: `tmux -f <conf> -C attach -t <name>` (or
`-C new-session -A -s <name> ...`). The client speaks a line protocol on stdio:

- **Output** (pane → us): `%output %<paneId> <data>\n`
  - `data` has control bytes **octal-escaped**: `\011`=TAB, `\033`=ESC,
    `\015\012`=CRLF. Printable bytes are literal. ANSI sequences arrive as e.g.
    `\033[31mRED\033[0m`. → un-escape `\NNN` to recover raw bytes for xterm.
- **Command replies**: `%begin <t> <n> <flags>` … `%end <t> <n> <flags>`
  (or `%error`). Every command we send gets a begin/end block.
- **Notifications**: `%session-changed`, `%layout-change`, `%window-add`,
  `%exit`, `%client-detached`, `%continue`, etc.
- **Input** (us → pane): send commands on stdin, e.g.
  - keystrokes: `send-keys -t %<pane> -H <hex bytes>` (hex is robust for raw
    bytes incl. ESC, paste, UTF-8).
  - resize: `refresh-client -C <cols>x<rows>` (control client viewport).
  - the client exits cleanly on EOF / `%exit` — no SIGHUP race, no fd to leak.

---

## 3. PoC — validate before committing

Goal: prove control mode renders claude correctly with acceptable input latency
and resize behavior. Throwaway code, not wired into the app.

### 3.1 Build (throwaway, `scripts/poc-control-mode/`)

A standalone Bun script that:
1. `Bun.spawn(['tmux','-f',CONF,'-C','new-session','-A','-s','poc','-x',C,'-y',R,
   'claude; exec zsh'])` with `stdin/stdout='pipe'`.
2. Parse stdout line protocol: handle `%output` (un-escape octal → raw bytes),
   `%begin/%end/%error`, `%exit`, `%layout-change`.
3. Expose a tiny WS endpoint (or reuse `/terminal`) that:
   - streams decoded `%output` bytes to xterm (raw, same as today);
   - on client input, writes `send-keys -t %<pane> -H <hex>\n` to tmux stdin;
   - on client resize, writes `refresh-client -C <cols>x<rows>\n`.
4. Point one real browser xterm tab at it.

### 3.2 Success criteria (must all pass)

- **Render**: claude/opencode TUI paints correctly — colors, box-drawing,
  alt-screen enter/exit (`?1049h/l`), cursor, full-screen redraw on resize. No
  garbage from mis-decoded escapes.
- **Input latency**: typing feels native. Measure round-trip (keypress → echo)
  vs the current node-pty path; must be within ~10ms. `escape-time 0` still
  honored (lone ESC vs sequences).
- **Resize/repaint**: shrinking/growing the window reflows claude correctly;
  no stuck size, no missing repaint (the `?1049h` passthrough concern from the
  tmux plan §Fase1).
- **Paste**: large paste + bracketed paste (`\033[200~`…`\033[201~`) arrive
  intact and ordered.
- **Special keys**: Ctrl-C, arrows, Ctrl-B (must reach claude, prefix is None),
  UTF-8 / emoji.
- **Stability**: kill the inner client / detach / many reconnects — no spin, no
  fd leak (`ls /proc/<pid>/fd`), CPU idle when quiet.

### 3.3 Measurement

- Latency: timestamp a synthetic keystroke, measure until its echo `%output`;
  100 samples, compare p50/p99 against node-pty.
- CPU: `/proc/<pid>/stat` while idle and while flooding output (`yes`); confirm
  no busy-loop and bounded CPU under flood.
- fd leak: `ls /proc/<pid>/fd | wc -l` across 50 create/destroy cycles.

### 3.4 Kill criteria (PoC fails → keep node-pty + current mitigations)

- Input latency p99 regresses noticeably vs node-pty, OR
- alt-screen TUI render is wrong / unfixable, OR
- control-mode parsing is fragile under output flood (drops/reorders).

### 3.5 Deliverable

`docs/poc-control-mode-findings.md`: latency numbers, render screenshots, CPU/fd
results, go/no-go.

---

## 4. Full implementation (if PoC passes)

### 4.1 Target architecture

```
Browser (xterm) ⇄ WSS /terminal/:id ⇄ apps/server (Bun)
                                         │  Bun.spawn pipes (NO PTY)
                                         ▼
                                   tmux -C (control client)
                                         ▼
                                   tmux daemon → claude/opencode
```

- **node-pty: removed.** **Node 18 worker: removed** (the control client is a
  plain stdio child Bun can spawn directly). **pty-sighup-exec: removed** (no
  PTY hangup → no SIGHUP race). **CPU monitor / in-worker watchdog: removed**
  (nothing to wedge). Keep tmux + `tmux.conf` exactly as is.
- Optional: keep a thin worker process only if we want crash isolation; not
  required for correctness. Default plan: fold it into the Bun server.

### 4.2 New module: `apps/server/src/pty/control.ts`

Replaces the worker + transport + node-pty. One `TmuxControlClient` per server
(a single `tmux -C` control client can drive **all** sessions on the server —
control mode multiplexes panes), OR one per session (simpler, more processes).
Decide in PoC; default: **one control client per session** for isolation and
simpler pane↔session mapping.

Responsibilities:
- `spawn(id, cols, rows, innerCmd, env)`: `Bun.spawn(['tmux','-f',CONF,'-C',
  'new-session','-A','-s',tmuxName(id),'-x',cols,'-y',rows, ...'-e',env, inner])`.
- Line parser: stdout → events. `%output %<pane> <data>` → un-escape → emit
  data (same `SessionState.buffer` + callbacks as today). `%exit` /
  `%client-detached` → emit exit. `%begin/%end/%error` → resolve pending cmds.
- `write(id, data)`: `send-keys -t <pane> -H <hex(data)>`.
- `resize(id, cols, rows)`: `refresh-client -C <cols>x<rows>`.
- `kill(id)`: `tmux kill-session -t <name>` (unchanged admin path).
- pane id: capture from the first `%output` / `%window-add` / `list-panes`.

### 4.3 What stays identical

- `PtyManager` public API (`spawnSession/write/resize/kill/onSessionData/
  onSessionExit/buffer/status`) — swap the transport underneath only.
- `SessionState` (buffer, callbacks, status), detector.ts (regex on buffer),
  WS handler, REST routes, reconcile/reattach logic, tmux.conf, session naming.
- Frontend: **zero changes** (same byte stream, same WS).

### 4.4 Lifecycle mapping

| Today (node-pty) | Control mode |
|---|---|
| worker spawns `pty-sighup-exec tmux new-session -A` in a PTY | `Bun.spawn tmux -C new-session -A` with pipes |
| `data` (base64 over IPC) | `%output` decoded inline (no IPC hop) |
| `write` to PTY | `send-keys -H` |
| `resize` PTY | `refresh-client -C` |
| worker death → reattach | control client death → respawn `tmux -C attach` (tmux session survives; same reattach guarantee, but death is now rare/normal) |
| boot reconcile | unchanged (tmux list/has-session) |

### 4.5 Risks & mitigations (carry from PoC)

- **Output flood / head-of-line**: a busy pane floods `%output`; ensure the
  parser is streaming and backpressure-aware. Mitigation: bounded read, same
  circular buffer cap as today.
- **Octal decode correctness**: unit-test the un-escape against known ANSI/UTF-8.
- **One-client-multiplex vs per-session**: if per-session is too many processes
  at scale, switch to a single multiplexed control client (pane↔session map).
- **send-keys for huge paste**: chunk hex, or use `load-buffer`/`paste-buffer`
  for large inputs.

### 4.6 Migration & rollback — RETIRED (completed)

All three phases shipped. The `PTY_BACKEND` flag, the node-pty path, the Node 18
worker, `pty-sighup-exec`, and `transport.bun` were removed in
`docs/plan-remove-node-pty.md`. Control mode is now the only backend; there is no
flag to flip and no rollback path other than `git revert`.

### 4.7 Test plan

- Unit: octal un-escape, hex encode (write), `%`-line parser (begin/end/error/
  output/exit), resize command formatting.
- Integration: spawn→stream→input→resize→kill against a real tmux (Node/Bun,
  not mocked, on a host with tmux).
- Regression: full existing suite green (manager/sessions/ws), detector
  unaffected (same buffer bytes).
- Soak: 50+ create/destroy cycles, output flood, idle-CPU and fd-count checks.

---

## 5. Decision log

- PoC gate first (§3). Only proceed to §4 on a clean go.
- Default-safe: flagged rollout, node-pty stays until control mode soaks in prod.
