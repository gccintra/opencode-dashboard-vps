# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Commands

```bash
# Development (all workspaces in parallel)
bun run dev

# Individual workspaces
bun run dev:web          # Vite → http://localhost:5173
bun run dev:server       # Elysia → http://localhost:3001

# Type checking
bun run typecheck        # tsc --noEmit across all workspaces

# Tests
bun test                 # vitest (apps/server + apps/web)
bun run test:fast        # vitest --reporter=dot --bail=1 (fast CI mode)

# Single test file
cd apps/web && bunx vitest run src/components/Terminal/XTermTerminal.test.tsx
cd apps/server && bunx vitest run src/routes/sessions.test.ts

# Lint / format
bun run lint
bun run format           # Prettier write
bun run format:check     # Prettier check (fails CI if drifted)

# Build
bun run build            # web + server production build
```

The Vite dev server proxies `/api/*` and `/terminal` to `http://localhost:3001` — no CORS config needed in dev.

---

## Architecture

Two processes communicate at runtime (plus the tmux daemon):

```
Browser (React + xterm.js)
  │  HTTPS REST + JWT
  │  WSS /terminal/:sessionId  (xterm stream)
  ▼
apps/server  (Bun + Elysia)
  │  one `tmux -C` (control-mode) client per session, over stdin/stdout pipes
  ▼
tmux server (daemon)
  │  runs the inner shell/CLI in each session
  ▼
opencode/claude CLI process (real PTY, owned by tmux)
```

The server spawns no PTY itself: each session is a `tmux -C` control client
(`Bun.spawn`, no native addon). There is **no `node-pty`, no separate Node worker**
— the manager talks to tmux directly via `ControlWorkerTransport`
(`apps/server/src/pty/control.ts`). One runtime (Bun) end to end.

### apps/server

Entry point: `src/index.ts`. Boot order matters:
1. `validateAuthEnv()` — exits if `AUTH_PASSWORD`/`JWT_SECRET` missing
2. `initDb()` — opens SQLite, sets WAL + foreign_keys, applies `schema.sql` (idempotent)
3. `scanResources()` — scans `~/.config/opencode/{skills,agents,mcps}/`
4. Elysia registers all route groups via `.use()`
5. After `app.listen(3001)`: starts `PtyManager.startStatusMonitor(1000)` and GitHub polling

**Adding a new route:** create `src/routes/yourroute.ts`, export an Elysia instance, and register it with `.use()` in `src/index.ts`. Forgetting `.use()` is silent — unit tests won't catch it.

### Transport message types

`WorkerTransport` (`apps/server/src/pty/transport.ts`) is the abstraction the
manager talks through. The message shapes (`ClientMessage`/`ServerMessage`) live
in `apps/server/src/pty/protocol.ts`:

Manager → transport: `spawn`, `write`, `resize`, `kill`, `list`, `shutdown`  
Transport → manager: `spawned`, `data`, `exit`, `killed`, `list`, `error`

`ControlWorkerTransport` (prod) maps these onto tmux control mode: input →
`send-keys -H <hex>`, resize → `refresh-client -C <c>x<r>`, output ← tmux
`%output` (octal-decoded inline). `InMemoryWorkerTransport` implements the same
interface for tests. `spawn` and `kill` are awaitable (5s timeout);
`write`/`resize` are fire-and-forget.

### Session Lifecycle

Sessions are **tmux-backed and resilient**: every session's real processes
(bash/claude/opencode) run inside a `tmux` server (a daemon independent of the
Bun server). The server only runs a thin `tmux -C` control client per session,
so it can be killed and respawned with **zero session loss**. Sessions survive a
server restart. See `apps/server/src/pty/tmux.ts` and `control.ts`.

- tmux sessions are named `alf_<sessionId>` (the `alf_` prefix avoids colliding with a human operator's own tmux sessions).
- `PtyManager` owns `Map<sessionId, SessionState>` (pid of the **control client**, ~50 KB circular buffer, 3 callback sets)
- Status is detected at 1 Hz via regex on the buffer: `waiting` (prompt detected), `active` (otherwise), `finished` (exit event)
- Closing the browser tab does NOT kill anything — only `DELETE /api/sessions/:id` does (it runs `tmux kill-session` **then** kills the control client)
- On disconnect, only the WS callbacks are removed from the session's Sets; the control client keeps running

**Spawn:** the control transport runs `tmux -C -f <tmux.conf> new-session -A -s alf_<id> -x <cols> -y <rows> '<innerCmd>'`. `-A` is idempotent (create-if-absent / attach-if-present), so the **same args** serve both the initial spawn and every reattach. Args are built by `buildTmuxSpawnArgs()` (`tmux.ts`); the `command` passed to `spawnSession` is the literal `'tmux'` (control derives the binary from `args[0]`). `<innerCmd>` is built by `buildCliCommand()` and ends with `exec zsh 2>&1 || exec bash`, so the session drops to a shell (instead of dying) when the CLI exits. Per-session env (`OPENCODE_ACTIVE_*`) is injected with tmux `-e KEY=VAL` because a new-session created in an already-running tmux server inherits the **server's** env, not the client's. The transparent tmux config lives in `apps/server/src/pty/tmux.conf` (status bar off, `prefix None`, `escape-time 0` — **non-negotiable for key latency**, truecolor, mouse off), resolved next to `tmux.ts` via `import.meta.url`.

**Server restart → reattach:** `PtyManager.setWorkerLostHandler` (wired in `index.ts`) re-attaches every session whose `tmux has-session` still passes (via `reattachSession`, which reuses the existing `SessionState` so the live WS keeps streaming with no client reconnect) and marks the rest exited. Reattach is lossless.

**Boot reconcile:** on startup `reconcileTmuxSessions()` re-adopts live `alf_` tmux sessions that have known metadata (spawns a fresh control client, flips status back to `active`) and reaps orphan tmux sessions with no metadata.

**Deployment prerequisite:** `tmux` (≥ 3.2 for `-e`; host has 3.4) must be on PATH. If tmux is absent the server logs a warning and sessions fall back to non-resilient behavior. No native addon, no Node 18, no `pty-sighup-exec` — Bun-only runtime.

**PTY transport:** the manager talks to tmux through a `WorkerTransport` abstraction; `getPtyManager()` always uses `ControlWorkerTransport` (tmux control mode, `apps/server/src/pty/control.ts`) — one `tmux -C` client per session over stdin/stdout pipes, **no PTY** (the node-pty Linux `read()=EAGAIN` CPU-spin bug is structurally impossible). `kill-session` runs via `tmux.ts` (route layer). Validated by `docs/poc-control-mode-findings.md` (sub-ms echo, no fd leak). The legacy `node-pty` worker backend was removed in `docs/plan-remove-node-pty.md` (the `PTY_BACKEND` flag and `apps/pty-worker` no longer exist). **PtyManager/WS/routes/detector/reconcile/reattach are transport-agnostic.**

### Frontend (apps/web)

**Routing:** `App.tsx` uses react-router-dom v7. Two layout branches:
- `AppLayout` (global sidebar) wraps: `/dashboard`, `/projects`, `/emergency`, `/sessions`, `/tasks`
- Full-screen (no sidebar): `/projects/:id` (ProjectDetail), `/projects/:id/sessions/:sessionId` (SessionTerminal), `/canvas`

**Key pages:**
- `ProjectDetail.tsx` — the primary workspace: terminal tab, files tab, canvas mode (mobile multi-terminal). Has a slide-in sessions sidebar on mobile (`fixed inset-y-0`), a `TerminalStatusBar` at the bottom, and switches between single-terminal (`XTermTerminal`) and multi-terminal canvas (`CanvasMobile`) views.
- `Canvas.tsx` — global full-screen canvas showing sessions from all projects. Mobile uses `CanvasMobile`; desktop uses `CanvasGrid`.

**Canvas components** (`src/components/Canvas/`):
- `CanvasMobile` — mobile multi-terminal layout; up to 3 slots arranged vertically; focused slot expands, others collapse to 52px strips. Uses `forwardRef` + `useImperativeHandle` to expose `sendKey`/`selectAll`/`getSelection` to parents.
- `CanvasGrid` — desktop grid layout (cols × rows)
- `CanvasSlot` — a single terminal slot in the grid

**Terminal component** (`src/components/Terminal/XTermTerminal.tsx`):
- Wraps xterm.js v6 + FitAddon + WebLinksAddon
- Manages its own WebSocket via `useTerminalSocket` hook
- `MobileKeyboard` component is exported from this file — renders as inline (footer bar) or floating FAB depending on `inline` prop. When `inline=true`, popup is `absolute bottom-full right-0` relative to its wrapper, so the button must be at the far right of its container to avoid off-screen overflow.
- `hideMobileFAB` prop suppresses the floating keyboard button (used when keyboard is placed in the status bar instead)
- `scheduleVisibilityFit` debounce is 300ms to cover the 200ms CSS transition in `MobileSlot`

**Key hooks:**
- `useTerminalSocket` — manages WebSocket with exponential backoff (1s→30s, max 10 attempts). Close codes 4001/4004 are permanent (no retry).
- `useSessions` — polls sessions every 10s + listens for `sessions-changed` custom event
- `useCanvasState` — persists slot assignments in `localStorage` keyed by projectId

### Auth

JWT HS256 (`jose` library — not `jsonwebtoken`, which has Node-only deps). Single password from `.env`. Token stored in `localStorage` as `auth_token`. The API client (`lib/api.ts`) injects `Authorization: Bearer` on every request and dispatches `auth:logout` custom event on 401. **WebSocket auth is deferred** — the WS upgrade is accepted before auth runs.

### Database

SQLite via `bun:sqlite`. Tables: `projects`, `project_resources`, `tasks`, `_migrations`. WAL mode enabled (generates `.db-wal` and `.db-shm` files — already in `.gitignore`). Schema is applied idempotently on every boot from `apps/server/src/db/schema.sql`.

For Vitest (which runs on Node, not Bun), `bun:sqlite` is mocked via `better-sqlite3` — see `apps/server/src/db/__mocks__/bun-sqlite.ts`.

---

## Key Conventions

**Mobile-first:** All UI must work at 375px before scaling to desktop. The main breakpoint is `sm` (640px) and `md` (768px).

**Design tokens:** Background `#0a0a0f`, card `#111118`, accent/neon `#af0` (`rgba(170,255,0,...)`), primary text `#f0f0f0`, secondary `#889`, muted `#556`, border `rgba(255,255,255,0.08)`. Fonts: Inter (UI), JetBrains Mono (code/terminal).

**Flex height chain:** Every flex ancestor in a scrollable subtree needs `min-h-0`. A single missing `min-h-0` breaks `overflow-y-auto` scroll anywhere in that chain.

**CSS transitions and terminal resize:** `MobileSlot` uses `transition-all duration-200`. Any `fit()` call must happen ≥300ms after a layout change (300ms = 200ms transition + 100ms buffer). Two timeouts are used: 300ms and 600ms.

**Path sanitization:** All file I/O routes must call `resolveSafePath(projectDir, relativePath)`. The pattern: null byte check → normalize backslashes → block absolute paths → verify `resolved.startsWith(projectDir + '/')`.

**Conventional Commits:** `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `merge:`

---

## Test Suite

Suite is **green**: server 558/558, web 592/592 (Node 22 — see Lessons Learned). No known pre-existing failures.

When running the full suite, V8 coverage output may be absent if uncaught exceptions abort vitest. Run coverage scoped to a specific file to work around this:
```bash
cd apps/web && bunx vitest run --coverage src/path/to/Component.test.tsx
```

---

## Lessons Learned

### 2026-06-13 - Bun/Elysia: HTTP 204 Not Supported in Response Constructor
**Context:** DELETE endpoints that return no body.
**Discovery:** Bun's `Response` constructor throws `Invalid response status code 204` when Elysia sets `set.status = 204` and returns without a body (`return;`). This is a Bun limitation, not standard HTTP behavior.
**Solution:** Use `set.status = 200; return { deleted: true };` instead of 204. This matches the pattern already used in `projects.ts` DELETE handler.
**Source:** This task (harness CRUD implementation)

### 2026-06-13 - Testing: Module-level Side Effects and Import Order
**Context:** Writing server tests for routes that use `process.env`.
**Discovery:** `apps/server/src/routes/harnesses.ts` calls `ensureHarnessesDir()` at module level (line 374). This means `HARNESSES_PATH` must be set in `process.env` BEFORE the routes module is imported. If the module is imported first (triggering `ensureHarnessesDir()` with the wrong path), then `HARNESSES_PATH` is set, the cached module won't re-execute `ensureHarnessesDir()`.
**Solution:** Always set `process.env.HARNESSES_PATH = tempDir` BEFORE `const { harnessesRoutes } = await import('./harnesses')`. Do NOT add redundant early imports of the route module. This pattern is followed correctly in the first `describe` block of `harnesses.test.ts`.
**Source:** This task (harness test phase)

### 2026-06-13 - Testing: No New Learnings from Harness Test Run
**Context:** Tester ran 143 harness-specific tests (88 server, 55 frontend) and full regression suite.
**Discovery:** All 143 new tests pass with no failures. Coverage exceeds 80% threshold on all new code (server routes: 90-97%, web components: 83-100%). Full regression suite shows only pre-existing failures unchanged.
**Solution:** No changes needed. Pre-existing failures remain documented in "Known Pre-existing Test Failures" section.
**Source:** This task (test phase)

### 2026-06-13 - Testing: Full Regression Suite (901 tests) — Only Pre-existing Failures
**Context:** Tester ran the complete vitest test suite across both apps/server and apps/web after harness feature implementation.
**Discovery:** All new harness tests pass (143/143). Server suite: 406/412 pass (6 pre-existing failures across sessions.test.ts and ws/handler.test.ts). Web suite: 399/489 pass (90 pre-existing failures across 9 files including ProjectDetail, Emergency, XTermTerminal, CodeEditor, FileTree, AppLayout, Sidebar, Sessions, Projects). No regressions introduced by harness feature.
**Solution:** The ws/handler.test.ts failure was added to the documented pre-existing failures list. No code changes needed for the harness feature.
**Source:** This task (test phase - full regression)

### 2026-06-22 - Testing: Vitest Requires Node 22, Not Node 18
**Context:** Running `bunx vitest run` in apps/server or apps/web.
**Discovery:** Under the repo's default Node 18, vitest crashes with `crypto is not defined` as soon as Elysia is imported — Node 18 lacks the global `crypto` that Elysia (and the test setup) relies on. Node 22 has it.
**Solution:** Run every vitest invocation with Node 22 on PATH, e.g. `PATH="/root/.nvm/versions/node/v22.22.3/bin:$PATH" bunx vitest run` (adjust the nvm path per machine). This is the test runner only — production runs on Bun. (Historical: this once mattered because the node-pty worker needed Node 18, since removed.)
**Source:** task-replace-sessions-polling-with-ws (test phase)

### 2026-06-23 - Testing: Reassigning `process.env` Breaks `os.homedir()`
**Context:** Testing a route that scans `~/.claude/projects` (resolved via `os.homedir()`) by pointing HOME at a temp dir.
**Discovery:** `process.env = { ...OLD_ENV }` (reassigning the whole object) detaches `process.env` from the native libuv environ. Node's `os.homedir()` reads the native environ (not the JS object), so after a reassignment it ignores any `process.env.HOME` you set and returns the real home — the test then scans the machine's real conversation history. Confirmed in Node 22. Setting `process.env.HOME = x` in-place (without reassigning the object) works fine.
**Solution:** In tests that need `os.homedir()` (or anything libuv-backed) to honor an env override, mutate `process.env` in place (`process.env.HOME = tmp`) and restore in place in `afterEach`. Never `process.env = {...}`. Also: resolve env-derived paths at call time inside the route (helper fn), not at module-load, so `vi.resetModules()` + re-import isn't even required.
**Source:** task-recover-conversations (conversations route test)
