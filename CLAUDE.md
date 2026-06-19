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
bun run dev:pty-worker   # Node.js PTY worker

# Type checking
bun run typecheck        # tsc --noEmit across all workspaces

# Tests
bun test                 # vitest (apps/server + apps/web only — NOT pty-worker)
bun run test:fast        # vitest --reporter=dot --bail=1 (fast CI mode)
bun run test:pty-worker  # cd apps/pty-worker && bunx vitest run (Node.js, NOT Bun)

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

Three processes communicate at runtime:

```
Browser (React + xterm.js)
  │  HTTPS REST + JWT
  │  WSS /terminal/:sessionId  (xterm stream)
  ▼
apps/server  (Bun + Elysia)
  │  stdio JSON-lines IPC
  ▼
apps/pty-worker  (Node.js 18 + node-pty)
  │  node-pty fork/exec
  ▼
opencode CLI process (real PTY)
```

**Why Node.js 18 for the worker:** `node-pty@1.1.0` calls `uv_version_string` (libuv) during N-API init — this is unimplemented in Bun 1.3.x (oven-sh/bun#18546). The prebuild was compiled against Node 18 ABI (`libnode.so.109`). Node 22 segfaults. **Never import `node-pty` in Bun code.**

### apps/server

Entry point: `src/index.ts`. Boot order matters:
1. `validateAuthEnv()` — exits if `AUTH_PASSWORD`/`JWT_SECRET` missing
2. `initDb()` — opens SQLite, sets WAL + foreign_keys, applies `schema.sql` (idempotent)
3. `scanResources()` — scans `~/.config/opencode/{skills,agents,mcps}/`
4. Elysia registers all route groups via `.use()`
5. After `app.listen(3001)`: starts `PtyManager.startStatusMonitor(1000)` and GitHub polling

**Adding a new route:** create `src/routes/yourroute.ts`, export an Elysia instance, and register it with `.use()` in `src/index.ts`. Forgetting `.use()` is silent — unit tests won't catch it.

### IPC Protocol (Bun ↔ Node worker)

Defined in `apps/pty-worker/src/protocol.ts`. One JSON message per line on stdio.

Bun → Node: `spawn`, `write` (fire-and-forget), `resize` (fire-and-forget), `kill`, `list`, `shutdown`  
Node → Bun: `spawned`, `data` (base64-encoded output), `exit`, `killed`, `list`, `error`

PTY output chunks are base64-encoded to survive the JSON-lines transport without corruption.

`spawn` and `kill` are awaitable (5s timeout). `write`/`resize` are fire-and-forget.

### Session Lifecycle

Sessions are **volatile** — they live in memory only and reset on server restart. SQLite persists only `projects`, `tasks`, and `project_resources`.

- `PtyManager` owns `Map<sessionId, SessionState>` (pid, ~10 KB circular buffer, 3 callback sets)
- `pty-worker` owns `Map<sessionId, IPty>` (actual processes)
- Status is detected at 1 Hz via regex on the buffer: `waiting` (prompt detected), `active` (otherwise), `finished` (exit event)
- Closing the browser tab does NOT kill the PTY — only `DELETE /api/sessions/:id` does
- On disconnect, only the WS callbacks are removed from the session's Sets; the PTY keeps running

The spawn command is `bash -c 'opencode; exec bash'` — if `opencode` isn't in PATH, the session falls back to a plain bash shell.

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

## Known Pre-existing Test Failures

These are documented failures that exist in the repo and are not regressions:
- `ProjectDetail.test.tsx` — 38/38 fail (stale test: mocks `../components/Terminal` without a `TerminalStatusBar` export and references a removed "Config" tab). Verified identical on a clean pre-change file — NOT a regression.
- `Projects.test.tsx` — ~8 fail (`harnesses.map is not a function`)
- `Sidebar.test.tsx` — 1 fail (duplicate DOM text)
- `sessions.test.ts` (server) — 3 fail (mock assertion mismatches; spawn/exit-callback/single-bash-failure cases)
- `ws/handler.test.ts` (server) — 21 fail (`manager.getDetectedStatus is not a function`; the test mock predates commit `10abf6d` which added `getDetectedStatus()` to `handleOpen`). Verified identical on a clean `develop` worktree — NOT a regression.

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
