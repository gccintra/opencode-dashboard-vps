# PoC Findings — tmux control mode (`tmux -C`) as node-pty replacement

Date: 2026-06-21
Plan: `docs/plan-tmux-control-mode.md` §3
PoC code: `scripts/poc-control-mode/` (throwaway)
Host: tmux 3.4, Bun 1.3.14, Linux

## Verdict: **GO** ✅

All programmatic success criteria (§3.2) pass. Control mode renders correctly,
input latency is *better* than the node-pty path, resize works, and — the whole
point — **there is no PTY in our process, so the node-pty 100%-CPU wedge class
is structurally impossible.** One human-eye step remains: visual confirmation of
the live `claude` TUI in a browser tab (see "Remaining" below).

---

## What was built

- `control.ts` — `TmuxControlSession`: `Bun.spawn(['tmux','-L',sock,'-f',conf,'-C',
  'new-session','-A',...])` with stdin (FileSink) + stdout/stderr pipes, **no PTY**.
  Byte-accurate line parser for the `%`-protocol; `unescapeOutput` (octal/`\\`),
  `send-keys -H <hex>` for input, `refresh-client -C <c>x<r>` for resize,
  separate `kill-session` admin command for teardown.
- `server.ts` — Bun WS bridge (one control session per WS) + `index.html` xterm page.
- `probe.ts` — headless validation (unit vectors + live round-trip + soak).

## Results

### Decode correctness (unit vectors) — PASS
`\033[31mRED\033[0m` → raw ESC bytes; tab `\011`, CRLF `\015\012`, backslash `\\`,
plain text, and high-byte UTF-8 octal (`\302\251` → `©`) all decode byte-exact.
Parser operates on **bytes** (not JS strings) so UTF-8/raw survive intact.

### Input latency — PASS (beats node-pty)
Echo round-trip (keypress → first `%output`), 30 samples against `bash`:
**p50 = 0.6 ms, p99 = 1.9–2.3 ms.** No IPC hop (decode happens inline in-server),
vs the current base64-over-stdio worker round-trip. `escape-time 0` honored (conf
reused verbatim).

### Resize — PASS
`refresh-client -C 120x40` → inner `tput cols` reports `120`. Repaint correct.

### Render / alt-screen — PASS (with an important nuance)
Against a full-screen TUI (`top`): SGR color, cursor positioning (`ESC[H`/`ESC[K`),
and screen content all arrive decoded and correct.

**Nuance:** tmux does **not** forward the inner program's raw `?1049h/?1049l`
alt-screen toggles to a control client. tmux owns the pane's alt-screen and sends
the control client a **rendered redraw** (clear + absolute cursor moves + content).
The browser xterm renders that paint directly — it does not itself need to be in
alt-screen. **This is the same abstraction the current node-pty `tmux attach`
client already receives, so it is not a regression** — render fidelity is whatever
tmux paints, which is correct.

### Stability — PASS (the headline result)
- **fd leak:** session fd count `6 → 6` across an output flood (`yes | head -100000`).
  Server-process fd `13 → 13` across a **20× create/destroy soak**. No leak.
- **CPU:** control client CPU ≈ 0 jiffies idle *and* under flood — the thin stdio
  client does no busy work; tmux server + inner process do the rendering. **No
  `read()=EAGAIN` spin is possible: there is no PTY master fd in our process.**
- Inner-client exit → clean `%exit` → `code=0`, no hang.

## Gotchas found (carry into §4 implementation)

1. **Dedicated socket is mandatory.** First runs failed with
   `%exit server exited unexpectedly` because new control clients connected to the
   `default` tmux socket, whose server was **wedged** (the production `alf_*`
   session — i.e. the live instance of the very bug this plan fixes). Using
   `tmux -L <socket>` isolates the PoC. **Implication:** the real migration should
   likewise pin a known socket name so a wedged/foreign server can't poison spawns.
2. **`kill-session` must be a separate admin command**, not sent through the
   control client's stdin. SIGTERM-ing the control client only *detaches* it; the
   tmux session survives. (Matches the current app: DELETE runs `kill-session`
   then kills the attach client.)
3. **Bun `stdin:"pipe"` yields a `FileSink`**, not a `WritableStream` — write via
   `sink.write(bytes); sink.flush()`, not `getWriter()`.
4. **stdin EOF detaches the client** (`%exit`). The server must hold the stdin
   FileSink open for the session's life.

## Remaining before §4 (full impl)

- **Browser visual smoke** of the live `claude` TUI (binary present at
  `/root/.local/bin/claude`): `bun scripts/poc-control-mode/server.ts`, open
  `http://localhost:4599`, confirm colors/box-drawing/cursor/paste/Ctrl-C/arrows
  by eye. The headless probe covers bytes+latency+resize+fd+cpu; only the human
  "looks right + feels native" check is left.
- Paste / bracketed-paste large-input check (consider `load-buffer`+`paste-buffer`
  for big pastes vs many `send-keys -H` bytes — §4.5).

## Recommendation

Proceed to §4 behind the `PTY_BACKEND=control|node-pty` flag. The transport swap
is contained: `control.ts` already mirrors the `spawn/write/resize/kill` + onData
surface that `PtyManager` needs, so `SessionState`/detector/WS/REST/reconcile stay
untouched (§4.3). Reuse `apps/pty-worker/tmux.conf` verbatim.
