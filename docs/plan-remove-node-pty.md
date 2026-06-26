# Plan — Remove the node-pty PTY backend

**Status:** DONE (executed 2026-06-26 on branch `refactor/remove-node-pty-backend`)
**Author:** generated 2026-06-26
**Precondition:** `control` (tmux control mode) has soaked stable in prod. Confirm
`PTY_BACKEND=control` (or unset → defaults to `control` at `manager.ts:805`) before
starting. This removal deletes the rollback flag, so do it only once `control` is trusted.

---

## Why

`control` is the production backend and the default. The entire `node-pty` path —
the separate Node 18 worker process, the `node-pty` native dependency (Node 18 ABI,
`libnode.so.109`), the `pty-sighup-exec` C wrapper, and the JSON-lines/base64 IPC —
exists now only as a dormant rollback flag. Removing it deletes:

- the `apps/pty-worker` worker process (`index.ts`) and its C build (`pty-sighup-exec.c`)
- the `node-pty` dependency and the Node 18 runtime requirement
- `BunWorkerTransport` (`transport.bun.ts`)
- the `PTY_BACKEND` branch in the manager
- ~half the PTY section of CLAUDE.md and several stale docs

Net: fewer moving parts, no native ABI fragility, one runtime (Bun) instead of two.

---

## DO NOT DELETE — shared by both backends

| File | Why it stays |
|---|---|
| `apps/pty-worker/src/protocol.ts` | `ClientMessage`/`ServerMessage` types imported at runtime by `manager.ts`, `control.ts`, `transport.ts`, `transport.memory.ts`. **Move** to `apps/server/src/pty/protocol.ts`, don't delete. |
| `apps/pty-worker/tmux.conf` | Read by `tmux.ts:resolveConfPath()` for `tmux -f`; control mode uses it too. **Move** to `apps/server/src/pty/tmux.conf` (update `resolveConfPath`). |
| `apps/server/src/pty/tmux.ts` | Used by control mode for spawn args, kill, has-session, reconcile. Only strip node-pty-only bits (see step 4). |

Because two files must survive, `rm -rf apps/pty-worker` is **wrong**. Move first, then delete the rest.

---

## Removal surface (delete)

| Path | Note |
|---|---|
| `apps/server/src/pty/transport.bun.ts` | `BunWorkerTransport` — only `manager.ts` imports at runtime |
| `apps/pty-worker/src/index.ts` | the Node 18 worker (only `BunWorkerTransport` spawns it) |
| `apps/pty-worker/src/index.test.ts` | worker tests |
| `apps/pty-worker/src/pty-sighup-exec.c` | SIGHUP wrapper, node-pty path only |
| `apps/pty-worker/package.json` + workspace dir | after `protocol.ts` + `tmux.conf` are moved out |

---

## Steps

### 1. Move shared files out of the worker
- `apps/pty-worker/src/protocol.ts` → `apps/server/src/pty/protocol.ts`
- `apps/pty-worker/tmux.conf` → `apps/server/src/pty/tmux.conf`
- Rewrite imports in `manager.ts`, `control.ts`, `transport.ts`, `transport.memory.ts`,
  `manager.test.ts` from `../../../pty-worker/src/protocol` → `./protocol`
  (`transport.bun.ts` also imports it but is deleted in step 3 — ignore).
- Update `tmux.ts:resolveConfPath()` to resolve the conf next to the module
  (drop the `apps/pty-worker` lookup).

### 1.5. Fix `apps/server/tsconfig.json` (else `tsc` breaks)
The server tsconfig hard-codes the worker path so the cross-package
`protocol.ts` import resolves. After the move it's a dangling path. Edit:
- `"rootDirs": ["./src", "../../pty-worker/src"]` → `"rootDirs": ["./src"]`
  (or drop `rootDirs` entirely — all sources are under `./src` now).
- `"include": ["src/**/*.ts", "../../pty-worker/src/protocol.ts"]`
  → `"include": ["src/**/*.ts"]`.

### 2. Collapse the transport selection
`apps/server/src/pty/manager.ts` (≈46-49, 802-808):
- Remove `import { BunWorkerTransport } from './transport.bun'`.
- Remove the `PTY_BACKEND` branch; always `new ControlWorkerTransport()`.
- Optionally keep reading `PTY_BACKEND` to warn-and-ignore for one release, or drop it outright.

### 3. Delete the node-pty path
- Delete `transport.bun.ts`.
- Delete `apps/pty-worker/src/index.ts`, `index.test.ts`, `pty-sighup-exec.c`.
- Delete `apps/pty-worker/package.json` and remove `apps/pty-worker` from root
  `package.json` `workspaces`.

### 4. Strip node-pty-only bits from tmux.ts
- `SPAWN_WRAPPER = 'pty-sighup-exec'` is node-pty-only. Control mode already
  ignores it: `control.ts:392` calls `client.spawn(args)` (args from
  `buildTmuxSpawnArgs`, starting with `'tmux'`) and **drops** the `command`
  field entirely. So the wrapper is dead weight under control. Remove the export.
- **Keep `buildTmuxSpawnArgs`** — used by both `control.ts` and `sessions.ts`
  (4 spawn sites). Only `SPAWN_WRAPPER` goes.
- Keep everything used by kill / has-session / reconcile / reattach.

### 4b. Update `sessions.ts` spawn sites (else `tsc` breaks)
`sessions.ts` imports `SPAWN_WRAPPER` (line 31) and passes it as the `command`
arg to `spawnSession` at **4 call sites** (≈307, 376, 566, 862). Removing the
export in step 4 breaks these. For each:
- Drop the `SPAWN_WRAPPER` import.
- The `command` arg is now meaningless (control derives the binary from
  `args[0] === 'tmux'`). Either pass `'tmux'` as a harmless placeholder, or
  change `spawnSession`/`PtyManager.spawnSession` to not require `command` and
  spawn straight from `args`. Placeholder is the smaller diff; signature change
  is cleaner. Pick one and apply to all 4 sites + the manager.
- Verify `manager.ts` (`this.transport.send({ type:'spawn', command, args, ... })`)
  still type-checks with whatever `command` becomes.

### 5. Root `package.json` script cleanup
Remove: `dev:pty:raw`, `dev:pty-worker`, `test:pty-worker`, and `apps/pty-worker`
from `bun run dev` fan-out. Drop `PTY_NODE_BIN` from `.env` / deploy if unused elsewhere.

### 6. Other references
- `apps/server/scripts/validate-pty.ts` — delete or repoint to control mode.
- `vitest.config.ts` — drop pty-worker include if present.
- Deploy: drop the Node 18 install step and `pty-sighup-exec` build/install
  (`docs/deploy.md`). Bun-only runtime now.

### 7. Docs
- CLAUDE.md: already updated (default `control`, shared-file note). Now also remove
  the "Why Node.js 18 for the worker" rationale and the node-pty half of **Spawn** /
  **PTY backend** once the code is gone.
- Mark `docs/plan-tmux-control-mode.md` §4.6 rollback as retired.
- Stale/historical (leave as history or prune): `docs/session-sighup-bug.md`,
  `docs/TUI_RENDERING.md`, `docs/ARCHITECTURE.md`, `PROJECT_CONTEXT.md`, `README.md`.

---

## Verification

1. `bun run typecheck` — no dangling `pty-worker/src/protocol` or `transport.bun` imports.
2. `PATH="<node22>/bin:$PATH" bunx vitest run` in `apps/server` — PTY/manager/control/tmux suites green.
3. Boot server, spawn a session, type, resize, kill — echo sub-ms, `tmux kill-session` works,
   reconcile re-adopts a live `alf_` session on restart.
4. `grep -rn "node-pty\|pty-sighup-exec\|BunWorkerTransport\|PTY_NODE_BIN" apps/ --glob '!**/*.lock'`
   returns only intentional history (docs), no live code.

---

## Rollback

This change **is** the removal of the rollback path. If `control` regresses after this lands,
revert the whole commit (git) rather than relying on the flag. Land it as one self-contained,
easily-revertable commit.
