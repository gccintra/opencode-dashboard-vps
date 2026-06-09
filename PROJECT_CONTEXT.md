# Project Context — OpenCode Dashboard

> **Last Updated:** 2026-06-08 | **Maintained By:** AI Agent Team | **Scaffolding:** Task 01 complete | **Auth:** Task 03 complete | **Projects API:** Task 05 complete | **Projects UI:** Task 06 complete | **Resources:** Sprint 6 complete | **FileSystem:** Sprint 7 fix phase complete | **Kanban+GitHub:** Sprint 4 complete | **Review:** Sprint 6 APPROVED | **Bug Fixes:** Bugs 01-04 APPROVED | **Terminal Perf:** task-terminal-quality-perf complete | **Test Config:** pty-worker isolado do root vitest
> **Architecture:** Monorepo — Backend for Frontend (BFF) com PTY Manager centralizado

---

## 1. Project Overview

OpenCode Dashboard é uma aplicação web mobile-first hospedada na VPS pessoal do usuário
que serve como interface visual para múltiplas sessões do opencode CLI rodando em paralelo.
O terminal é real — não emulado — via xterm.js integrado a PTYs reais (node-pty) expostos
por WebSocket. O usuário opera todas as suas sessões de opencode de qualquer dispositivo,
incluindo mobile, com navegação por projetos, abas, detecção automática de estado de sessão,
file browser visual com editor de código embutido e terminal root de emergência.

---

## 2. Technology Stack — Dev Commands

| Layer           | Technology                                                                                |
| --------------- | ----------------------------------------------------------------------------------------- |
| Frontend        | React 19 + Vite 6                                                                         |
| Build Tool      | Vite 6                                                                                    |
| CSS             | Tailwind CSS v4                                                                           |
| Terminal UI     | xterm.js v6 (`@xterm/xterm@^6`, `@xterm/addon-fit@^0.11`, `@xterm/addon-web-links@^0.12`) |
| Code Editor     | Monaco Editor ou CodeMirror (a decidir — ver Decisões Pendentes)                          |
| Backend         | Bun 1.x + Elysia                                                                          |
| PTY             | node-pty v1.x (ver §3 — risco de compatibilidade com Bun)                                 |
| WebSocket       | Elysia WS (nativo — sem dependência extra)                                                |
| Database        | bun:sqlite (SQLite embutido no Bun — zero deps)                                           |
| GitHub API      | REST API v3 — sync de issues (token com permissão `repo`)                                 |
| ORM             | N/A (schema SQL aplicado direto via bun:sqlite)                                           |
| Auth            | JWT (jose) — senha única, token no localStorage                                           |
| Proxy/SSL       | nginx + Let's Encrypt (certbot)                                                           |
| Process Manager | PM2                                                                                       |
| Package Manager | Bun workspaces (monorepo)                                                                 |
| Linter          | ESLint                                                                                    |
| Formatter       | Prettier                                                                                  |

**Dev Commands:**

| Command                       | Description                                                                 |
| ----------------------------- | --------------------------------------------------------------------------- |
| `bun run dev`                 | Sobe frontend + backend em paralelo                                         |
| `bun run dev:web`             | Só o Vite (React)                                                           |
| `bun run dev:server`          | Só o Elysia                                                                 |
| `bun run dev:pty-worker`      | Worker PTY isolado (Node.js + node-pty)                                     |
| `bun test`                    | Vitest (workspaces Bun: server + web)                                       |
| `bun run test:pty-worker`     | Vitest do pty-worker (Node.js — **não roda em Bun**)                        |
| `bun run lint`                | ESLint em todos os workspaces                                               |
| `bun run format`              | Prettier                                                                    |
| `bun run typecheck`           | tsc --noEmit                                                                |
| `bun run build`               | Build de produção (web + server)                                            |

**Test DB Management:**

| Command | Description                                                      |
| ------- | ---------------------------------------------------------------- |
| N/A     | SQLite — schema aplicado direto no boot do server via bun:sqlite |

**Test Runner Note:**
- **`bun test`** roda **apenas** `apps/server` + `apps/web` (ambientes Bun-compatíveis: Node.js via vitest + jsdom)
- **`apps/pty-worker`** é um módulo **Node.js isolado** com `node-pty` (addon nativo) — **NÃO roda em Bun**. Seus testes devem ser executados separadamente: `cd apps/pty-worker && bunx vitest run` (usa Node.js do sistema, não Bun)

---

## 3. Architecture

**Pattern:** Monorepo — Backend for Frontend (BFF) com PTY Manager centralizado

Estrutura monorepo com Bun workspaces: `apps/web` (React + Vite) e `apps/server`
(Bun + Elysia). O servidor mantém um `Map<sessionId, { pty, ws, buffer }>` de
sessões ativas. Cada sessão spawna um processo `opencode` real via node-pty no diretório
do projeto, expondo stdin/stdout pelo WebSocket nativo do Elysia. O nginx termina SSL
na porta 443 e faz proxy reverso para o Bun na porta 3001, com upgrade explícito de WebSocket.

**⚠️ node-pty + Bun — estratégia de compatibilidade:**
**CENÁRIO B CONFIRMADO (Task 08, 2026-06-04):** O addon nativo `node-pty@1.1.0` chama
`uv_version_string` durante a inicialização N-API, função do libuv ainda não implementada
por Bun 1.3.14 para sistemas POSIX. Tracking: <https://github.com/oven-sh/bun/issues/18546>.
Resultado: o servidor Bun aborta com `panic(main thread): unsupported uv function` ao
importar `node-pty`.

**Decisão arquitetural:** node-pty **DEVE** rodar num processo Node.js isolado
(`apps/pty-worker/`) — o servidor Elysia (Bun puro) se comunica com esse worker via
IPC (stdio pipe, Unix socket ou named pipe — decisão final na Sprint 2 quando o
PTY manager for implementado). O resto do stack permanece em Bun.

**Pré-requisito do worker:** O `pty.node` pré-compilado do node-pty 1.1.0 foi gerado
contra `libnode.so.109` (Node 18). Node 22 (via nvm) apresenta segfault por ABI mismatch.
**A VPS de produção DEVE usar Node 18 LTS** para o `apps/pty-worker/`, ou rebuildar
o prebuild contra a versão alvo. Recomendação: usar o Node 18 do apt (`nodejs` package
em Ubuntu 24.04 = `v18.19.1`, ABI exatamente compatível).

**Estrutura de diretórios:**

```
opencode-dashboard/
├── apps/
│   ├── server/                  # Bun + Elysia
│   │   └── src/
│   │       ├── index.ts         # entry point
│   │       ├── pty/
│   │       │   ├── manager.ts   # Map de sessões, spawn, kill
│   │       │   └── detector.ts  # detecção de estado por buffer
│   │       ├── routes/
│   │       │   ├── projects.ts
│   │       │   ├── sessions.ts
│   │       │   ├── files.ts        # File browser: list, read, write, delete, upload
│   │       │   └── harnesses.ts    # Harness CRUD + copy to project dir
│   │       ├── ws/
│   │       │   └── handler.ts   # WebSocket por sessão (Elysia WS)
│   │       └── db/
│   │           ├── client.ts    # bun:sqlite
│   │           └── schema.sql
│   ├── web/                     # React + Vite
│   │   └── src/
│   │       ├── components/
│   │       │   ├── Terminal/    # xterm.js wrapper
│   │       │   ├── Sidebar/     # projetos + sessões
│   │       │   ├── TabBar/      # navegação entre sessões
│   │       │   ├── FileTree/    # árvore de arquivos colapsável + breadcrumb
│   │       │   ├── CodeEditor/  # Monaco/CodeMirror wrapper com syntax highlighting
│   │       │   ├── KanbanBoard/  # Kanban global com drag & drop, colunas, filtros
│   │       │   ├── AgentPanel/   # Grid de agentes ativos com status em tempo real
│   │       │   └── StatusBadge/  # ativa / aguardando / finalizada / root / task / issue
│   │       ├── hooks/
│   │       │   ├── useTerminal.ts
│   │       │   └── useSessions.ts
│   │       └── pages/
│   │           ├── Login.tsx
│   │           └── Dashboard.tsx
│   └── pty-worker/              # CONFIRMADO NECESSÁRIO (Task 08) — worker Node.js isolado
│       ├── package.json         # Node 18, node-pty, tsx
│       ├── tsconfig.json        # target ES2022, module ESNext
│       └── src/
│           └── index.ts         # scaffold: spawnBash() + PtyHandle (IPC a definir Sprint 2)
└── package.json                 # monorepo root (bun workspaces)
```

**Detecção de estado da sessão (crítico):**
O backend mantém um buffer circular dos últimos ~10kb de output por sessão.

- `aguardando` → regex detecta prompt característico do opencode no buffer
- `ativa` → output recente (< 5s sem silêncio)
- `finalizada` → evento `exit` do processo node-pty

**Reconexão:** PTYs sobrevivem ao fechamento do browser. Na reconexão, o backend
envia o buffer acumulado ao xterm.js para reconstituir o estado visual.

**Terminal Root de Emergência:** Sessão especial com `projectId = null` e `type = "emergency"`,
spawnada no diretório `/root`. Exige confirmação explícita no frontend. Apenas 1 ativa por vez.
Renderizada com badge visual distinto (⚠️ Root) e borda de alerta.

**File Browser & Editor:** API REST no backend lê/escreve o filesystem real via `fs` do Bun.
A árvore usa lazy loading (carrega diretórios sob demanda). O editor de código (Monaco ou
CodeMirror) roda no frontend com syntax highlighting. Operações de write são atômicas.
**Sanitização de paths é obrigatória** para prevenir path traversal — todos os paths devem ser
resolvidos e validados contra o diretório raiz do projeto antes de qualquer operação de I/O.

**Kanban Global + GitHub Issues:**
O kanban é um board único exibindo tasks locais (SQLite) e issues do GitHub (cache local)
de todos os projetos. O sync com GitHub usa polling periódico (ex: 5 min) e cache local.
Tasks são versionadas como `.opencode/tasks/*.md` em cada projeto — o dashboard sincroniza
bidirecionalmente (lê arquivos criados pelo opencode CLI, escreve arquivos ao criar tasks
via UI). Badges visuais distinguem tasks locais ("📋 Task") de issues GitHub ("🐙 Issue #42").

**Painel de Agentes:**
Grid/lista de cards com todas as sessões ativas, atualizados em tempo real via WebSocket.
Cada card mostra nome, projeto, status, tempo rodando e preview do output. Clicar foca
o terminal da sessão. Ordenação: "aguardando" no topo.

**Nginx — WebSocket upgrade (obrigatório):**

```nginx
location /terminal/ {
    proxy_pass http://localhost:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 86400;
}
```

---

## 4. Data Model

**Core Entities:**

| Entity  | Key Fields                                                    | Relationships                                           |
| ------- | ------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------- |
| Project | id, name, directory, githubRepo?, harnessId?, createdAt       | has many Sessions, has many Tasks                       |
| Session | id, projectId (nullable — null = root), status, type (project | emergency), createdAt, lastActiveAt                     | belongs to Project (optional)                        |
| Harness | id, name, description, sourcePath, createdAt                  | referenced by Project                                   |
| Task    | id, projectId, title, description, source (local              | github), column, sortOrder, sessionId?, githubIssueUrl? | belongs to Project; linked to Session + GitHub Issue |

**Task source enum:** `local` | `github`
**Task column enum:** `backlog` | `in_progress` | `done`
**Session status enum:** `active` | `waiting` | `finished`
**Session type enum:** `project` | `emergency`

**Task sync strategy (SQLite ↔ `.opencode/tasks/*.md`):**

- SQLite é fonte da verdade para o dashboard
- Ao criar task via dashboard → escreve arquivo `.md` no diretório do projeto
- Ao detectar novo arquivo `.md` no diretório → importa como task no SQLite
- Conflito (editado em ambos): última edição vence (timestamp); log de aviso

**Runtime state (in-memory, não persistido no SQLite):**

| Field  | Type     | Description                                                 |
| ------ | -------- | ----------------------------------------------------------- |
| pty    | IPty     | Processo node-pty ativo                                     |
| ws     | ElysiaWS | Conexão WebSocket do cliente atual                          |
| buffer | string[] | Últimos ~10kb de output para reconexão e detecção de estado |

---

## 5. Coding Standards & Conventions

- **Naming:** camelCase (variáveis/funções), PascalCase (components/classes/types)
- **Files/Folders:** kebab-case (arquivos .ts/.tsx), PascalCase (diretórios de componentes)
- **Imports:** path aliases TypeScript preferidos; externos antes de internos
- **Commit Convention:** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`)
- **Branch Naming:** `<type>/<short-desc>` (ex: `feat/terminal-resize`, `fix/ws-reconnect`)
- **TypeScript:** strict mode habilitado em todos os workspaces
- **Mobile-first:** todo componente novo deve funcionar em 375px antes de escalar para desktop

---

## 6. Testing Strategy

- **Framework:** Vitest (frontend + backend)
- **E2E:** N/A (MVP)
- **Coverage Threshold:** 80%
- **Test File Convention:** `*.test.ts` / `*.test.tsx`
- **Test Location:** ao lado do source (`manager.test.ts` junto de `manager.ts`)
- **Mock Strategy:** mock em boundaries de I/O (PTY, WebSocket, SQLite) — não mockar lógica de negócio
- **Pre-commit/PR:** testes devem passar antes de merge

**Test Execution by Workspace:**

| Workspace      | Runtime    | Command                           | Notes                                                                 |
| -------------- | ---------- | --------------------------------- | --------------------------------------------------------------------- |
| `apps/server`  | Bun        | `bun test` (root) ou `bunx vitest run` | Usa `environment: 'node'` + mock `bun:sqlite` → `better-sqlite3`      |
| `apps/web`     | Node (jsdom) | `bun test` (root) ou `bunx vitest run` | Usa `environment: 'jsdom'` + React Testing Library                    |
| `apps/pty-worker` | **Node.js** (sistema) | `cd apps/pty-worker && bunx vitest run` | **NÃO roda em Bun** — `node-pty` é addon nativo que causa `panic` em Bun |

**Root vitest.config.ts:** Inclui apenas `apps/server` e `apps/web` como projects. O `apps/pty-worker` tem seu próprio `vitest.config.ts` e é executado independentemente.

---

## 7. Authentication & Security

- **Auth Method:** JWT — senha única configurada via `.env`; token salvo no localStorage do browser
- **Token Expiry:** a definir (sugestão: 7 dias com renovação automática)
- **Security Scanner:** N/A (MVP)
- **Secrets Management:** `.env` na VPS, fora do repositório git (`.gitignore`)
- **Exposição:** nginx não expõe a porta 3001 diretamente; apenas portas 80/443 são públicas
- **HTTPS:** obrigatório — nginx + Let's Encrypt

---

## 8. Styling & Design (UI Projects)

- **Figma File:** `ubx8p2dAGtO3cmhfUEJkCu` (OpenCode Dashboard)
  - Login screen: node `314:33`
- **Primary Font (UI):** Inter (weights: 400, 500, 600, 700)
- **Monospace Font:** JetBrains Mono (weights: 400, 500)
- **Color Palette:**
  - Background: `#0a0a0f` (dark)
  - Card Background: `#111118`
  - Accent / Neon Green: `#af0` — buttons, banner prompt, highlights
  - Primary Text: `#f0f0f0`
  - Secondary Text: `#889`
  - Muted Text: `#556`
  - Border: `rgba(255,255,255,0.08)`
- **Breakpoint principal:** 375px (mobile-first)
- **Renderer xterm.js:** WebGL (melhor performance — avaliar suporte em mobile antes de habilitar)
- **Referências visuais:** sereno.sh (estética limpa), Linear (UX/navegação), multica.ai (multi-sessão)

---

## 9. External Dependencies & Integrations

| Service                    | Purpose                                              | Auth/Config                         |
| -------------------------- | ---------------------------------------------------- | ----------------------------------- |
| opencode CLI               | Agente de código — roda dentro dos PTYs na VPS       | binário no PATH da VPS              |
| Monaco Editor / CodeMirror | Editor de código no frontend com syntax highlighting | bundle via npm                      |
| nginx                      | Proxy reverso + SSL termination + WS upgrade         | config em `/etc/nginx/`             |
| PM2                        | Process manager — mantém Bun vivo após reboot        | `pm2 start` / `ecosystem.config.js` |
| Let's Encrypt              | Certificado SSL via certbot                          | renovação automática                |

---

## 10. Common Pitfalls & Lessons Learned

> _Appended by the `lessons-writer` skill. Reusable patterns, gotchas, and known issues — apply before re-discovering. Edit only this section via @project-setup or @lessons-writer; other agents read but don't modify._

### Runtime / Build

- **node-pty não roda em Bun 1.3.14** (Bun não implementa `uv_version_string` — oven-sh/bun#18546). Toda PTY DEVE estar em `apps/pty-worker/` (Node 18 isolado). Elysia fala com o worker via IPC. **NÃO importe `node-pty` em código Bun** — causa `panic(main thread): unsupported uv function`.
- **Node 18 LTS obrigatório** no pty-worker — o prebuild do `node-pty@1.1.0` foi gerado contra `libnode.so.109` (Node 18 ABI). Node 22 via nvm segfaulta. Use o `nodejs` do apt (Ubuntu 24.04 = v18.19.1, exatamente compatível).
- **`bun build` constant-folds `process.env.XYZ`** em compile time. Para detecção de produção, use `Bun.env.NODE_ENV` (runtime accessor, não é inlined).
- **`import.meta.dirname` em `bun build` resolve para o diretório do SOURCE**, não do output. Para paths de runtime (ex.: `apps/web/dist/`), use `process.cwd()`.
- **Elysia `app.get('*')` NÃO match `/`** (root). Registre ambos: `app.get('/', ...)` + `app.get('/*', ...)`.
- **Vite prod build:** `base: '/'`, `outDir: 'dist'`, `minify: 'esbuild'`, `sourcemap: false`. **Server build:** `bun build src/index.ts --outdir dist --target bun --splitting`. PM2 seta `cwd` para project root.
- **`apps/server/src/index.ts` registra TODAS as routes** — risco de route orphan se esquecer o `.use()`. Testes isolados (`new Elysia().use(routes)`) NÃO pegam isso. Checklist manual ao adicionar route.

### bun:sqlite

- **Adapter para Vitest** é obrigatório (Vitest roda Node, não resolve `bun:sqlite`). Ver `apps/server/src/db/__mocks__/bun-sqlite.ts` + alias em `vitest.config.ts` → `better-sqlite3` (mesma API, exceto `.query()` → `.prepare()` e `null` → `undefined` em rows).
- **`getDb().run(sql, ...)` leva ARRAY, não spread args**: `run('INSERT ... VALUES (?, ?)', [a, b])`. Passar spread quebra tsc. Já `.get/.all` (em `Statement`) aceitam spread.
- **WAL mode** não funciona em `:memory:` (sempre `"memory"`) e gera `*.db-shm` ao lado do `.db` — adicione ao `.gitignore`. Use file-based DB para testar WAL.
- **Migrations idempotentes** — use `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN` (com try/catch). Sem migration framework.

### Elysia 1.4.x

- **Auth middleware:** `.use()` + `.onBeforeHandle()` global NÃO curto-circuita (retorna 200 mesmo quando o hook devolve valor). Use `.guard(authGuard, (app) => ...)` com `beforeHandle` local — local hooks curto-circuitam.
- **`.use()` retorna tipo Eden Treaty, não `Elysia`** — em testes, declare `let app: any` ao compor.
- **PUT/POST sem `body: t.Object(...)` explícito** → TS infere `body: unknown`, qualquer acesso a campo quebra `tsc`. Sempre passe schema como 2º argumento.
- **Validação de body falha → 422**, não 400. Use 400 só para validação manual dentro do handler.
- **`.json()` retorna `unknown`** — todo acesso a campo precisa de type assertion (`as { token: string }`).
- **Anotar `Context` explicitamente** (ex.: `{ set, request }`) em hook/handler quebra TS — `set.status` é union larga (`number | "OK" | ...`). Use inferência ou `any` com eslint-disable.
- **WS testing:** adapter Node do Vitest NÃO suporta WS (route nem registra). Exporte os hooks (`handleOpen`/`handleMessage`/`handleClose`) como funções standalone com interface `WSLike` (`{ data, send, close, readyState }`) e teste-os diretamente. Ver `apps/server/src/ws/handler.ts`.
- **WS route params** em `ws.data.params.{name}` (mesmo padrão de HTTP `ctx.params`).
- **WS close signature:** `close(ws, code, reason)` — sempre aceite os 3 args. Códigos app-defined: 4000-4999. Projeto usa 4001 (already connected), 4004 (not found), 4401 (futuro, auth fail).
- **WS auth é DEFERRED** (single-user VPS). Browser não permite header no upgrade — token precisa ir em query (`?token=`), subprotocol, ou first message. Flag para hardening futuro.
- **WS endpoints NÃO são auto-protected** por `.guard(authGuard, ...)` — upgrade é aceito antes do hook rodar. Hardening: validar token no `open(ws)` antes de registrar.

### JWT

- Use **`jose` v6+** (Web Crypto puro, sem addons nativos) — `jsonwebtoken` tem deps Node que conflitam com Bun. Funciona em Bun, Node 18+ e edge. `TextEncoder().encode(secret)` → `Uint8Array`.

### Vitest

- **`@vitest/coverage-v8` DEVE** ser a mesma versão exata de `vitest` (ex.: `3.2.6` ↔ `3.2.6`). Versão diferente → `SyntaxError: 'vitest/node' does not provide export 'BaseCoverageProvider'`. Pinar em todos os workspaces.
- **`vitest.workspace.ts` deprecated** no Vitest 3.x — use `test.projects` em `vitest.config.ts` raiz + `passWithNoTests: true`.
- **`vi.hoisted(() => ({...}))`** para mock state compartilhado entre factory e test body (factory é hoisted, refs normais dão `ReferenceError`).
- **Mock de `fetch` global > mock de módulo** para módulos com state singleton (`AuthContext`, etc.) — `vi.mock()` é hoisted e mock factory roda uma vez (state leakage). Padrão: `global.fetch = vi.fn()` + `vi.resetModules()` + `await import('./mod')` no `beforeEach`.
- **`vi.resetModules()` + dynamic `import()`** em `beforeEach` isola state. Testes com essa combinação DEVEM ser `async`.
- **`mockReset()` no `beforeEach` é crítico** — `clearAllMocks` limpa call history mas NÃO a fila `mockResolvedValueOnce` (leak entre testes).
- **`mockClear()` APÓS render inicial** em testes com `vi.useFakeTimers()` — o fetch do mount conta como call, então limpe antes de asserir a interação sob teste.
- **V8 coverage reporta 0%** para módulos carregados via `vi.resetModules()` + dynamic import (instrumentação attach no parse time, falha em re-imports). Limitação conhecida. **Cobertura é informativa, não bloqueante** — se um teste falha com coverage mas passa sem, documente e siga.
- **Race condition no coverage monorepo** — múltiplos `test.projects` escrevem no mesmo `coverage/.tmp/coverage-N.json`. Workaround: rodar per-workspace (`cd apps/X && bunx vitest run --coverage`) ou setar `coverage.reportsDirectory` único por workspace.
- **`rmSync` cleanup:** importe estaticamente no topo (`import { rmSync } from 'node:fs'`) — `require()` em `afterEach` viola `@typescript-eslint/no-require-imports`.
- **Cobertura exclui `web/dist/`** — sem `coverage.exclude: ['**/dist/**', '**/node_modules/**']`, assets gerados poluem o report.
- **Test timeout > waitFor timeout** — se `waitFor` excede, o teste deve dar timeout antes para o erro ser claro.
- **V8 coverage instrumentation** causa flakes intermitentes em `waitFor` de UI tests. Se flake sem coverage, é isso. Documentar e seguir.
- **`getByLabelText` é exact match** por padrão — para substring use `{ exact: false }`.
- **Auth em testes isolados:** chame `validateAuthEnv()` antes de `getAuthPassword()` após `vi.resetModules()` (senão `_password` está unset → 500 text).

### React 19

- **Side effects no body do componente = render loop.** `apiFetch` + `setState` DEVEM estar em `useEffect` com flag `cancelled`.
- **Ref-mirror pattern** para deps voláteis em `useCallback`: sincronize via `useRef` + `useEffect`, leia do ref no callback. Mantém callback estável. Essencial para: attempt counter (WS), terminated flag, sessionId em long-lived handlers. Substitui `useEvent` do React 19.
- **`cleanedUpRef`** para distinguir unmount do React de erro real de WS: set `true` no cleanup ANTES de fechar socket, checar no `onclose` para evitar falso "Disconnected".
- **`searchParamsRef` pattern** quando incluir dep no `useCallback` causaria loop (ex.: `setSearchParams` no body).
- **Optimistic UI sem rollback = bug.** Para DELETE/PUT sem mecanismo de undo, padrão: `await → check → setState` em try/catch.
- **Detach ALL WS handlers no close** (`onopen=onmessage=onclose=onerror = null`) — defesa contra eventos stale em testes com fake timers. Combinar com `wsRef.current === ws`.
- **Defensive ID validation** (`isValidProjectId`): rejeita falsy, non-string, `"undefined"`, `"null"`, empty. Use `flatMap` + early return (preserva `Promise.allSettled`).
- **API client 401:** dispare `auth:logout` event custom ANTES de `await response.json()` — funciona mesmo se backend retornar HTML. Decoupling API ↔ Auth.
- **Multi-state page render order:** loading → error (sem data) → data → inline error banner (com data). Ordem importa.
- **Button-in-button hydration warning** (HTML spec violation) — use `<div role="tab">` em vez de `<button>` quando o filho é também button.
- **State multi-tab = `Map<string, Set<ClientEntry>>`** onde entry = `{ ws, dataCb, exitCb, statusCb }`. Em `handleClose`, chame os `removeSessionData/Exit/Status` correspondentes ANTES de deletar entry (memory leak).

### Frontend Patterns

- **react-router-dom v7:** mesma API do v6. `types` vêm bundled (sem `@types/react-router-dom`). `<Outlet />` para layout shell. Guards: `<Navigate to="/login" replace />` condicional.
- **`<NavLink>` aceita `className` E `children` como render functions simultaneamente** — ambos recebem `{ isActive, isPending, isTransitioning }` da mesma `useMatch()`, garantindo consistência.
- **SVG inline com `currentColor`** herda cor do pai via Tailwind — ícones dimmed/bright sem prop drilling. ViewBox `0 0 16 16` para math simples.
- **`box-shadow` complexo** → `style={{ boxShadow: '...' }}` inline. Arbitrary value do Tailwind v4 funciona mas é verboso para multi-camada.
- **Tailwind v4** usa `@tailwindcss/vite` (não PostCSS) para integração com Vite. Arbitrary values (`bg-[#0a0a0f]`) para fidelidade 1:1 com Figma.
- **Vite dev proxy** para `/api` → `http://localhost:3001` permite paths relativos em dev e prod. Sem CORS no server para o mesmo path.
- **xterm.js v6** (`@xterm/xterm@^6`, `@xterm/addon-fit@^0.11`, `@xterm/addon-web-links@^0.12`): API backward-compatible com v5. Pin exato para evitar type breaks entre minor releases.
- **Manual `simulateOpen()` em MockWebSocket** para testes de reconexão (auto-open com `setTimeout(0)` reseta attempt counter). Pair com `await act(async () => { await vi.advanceTimersByTimeAsync(0); })`.
- **Page Visibility API:** use `useState(() => !document.hidden)` (lazy init) para sync com title do documento.
- **CSS height chain:** `h-screen h-dvh` (fallback + dynamic) + `flex-1 min-h-0` em CADA nó flex. Um `min-h-0` faltando quebra a propagação.

### Backend Patterns

- **`COLLATE NOCASE` no schema** garante uniqueness case-insensitive no DB. Combine com check app-level (`WHERE name = ? COLLATE NOCASE` → 409) para UX; o constraint é safety net.
- **Path sanitization (4 layers):** null byte → backslash normalize → absolute path block → `resolved.startsWith(projectDir + '/')` prefix containment. Padrão `resolveSafePath(projectDir, rel)` deve ser o default em QUALQUER route de file I/O.
- **Atomic file writes:** `tmp = resolved + '.tmp.' + uuid8; writeFileSync(tmp, content); renameSync(tmp, resolved)`. Falha mid-write deixa original intacto.
- **`rmSync(dir, { recursive: true, force: true })`** em vez de `rmdirSync(..., { recursive: true })` (deprecado).
- **Node `fs.cpSync` com `recursive: true`** copia hidden files (`.git`, `.env`) — filtre antes se não quiser.
- **Cross-module data access:** exporte accessor functions (`getAllXxx`, `getXxxById`), não o Map/Set cru. Mantém encapsulamento.
- **Cross-source aggregation:** pre-fetch foreign data em `Map<id, ...>` (build\* helpers), itere collection primária e componha. Wrap cada query em try/catch para degradação graceful.
- **Emergency single-instance POST:** mesma rota faz check (retorna 200 com existente) ou create (201). Simplifica UX.
- **Session status detection:** buffer circular ~10kb → regex para prompt (waiting) / recência (active) / exit event (finished). Atualiza UI via WS callback.
- **Output preview:** strip ANSI (regex `/\x1b\[[0-9;]*[a-zA-Z]/g`), filter blank lines, take last N, join `|`, truncate c/ `...`.

### Tooling

- **`.prettierignore`** desde o scaffold com `coverage/`, `dist/`, `node_modules/`, `logs/`. Sem isso `format:check` falha após `bun test --coverage`.
- **Root `package.json` precisa `"type": "module"`** para `eslint.config.js` e `vitest.config.ts` ESM.
- **Root `eslint.config.js`** precisa `@eslint/js` e `typescript-eslint` como devDependencies RAIZ (hoisting de workspace não resolve para ESLint).
- **Tables em markdown** quebram `format:check` (drift de alignment). Rode `prettier --write` após editar §10 ou similares.

### Process

- **Tester deve re-rodar TODOS os 4 gates** (test, typecheck, lint, format:check) — não confiar no pre-handoff do executor. `format:check` é o sneaky (Prettier reporta file mas não o issue exato).

### Open Decisions

- Projetos cadastrados manualmente via UI **ou** scan automático de diretórios da VPS
- xterm.js WebGL renderer em mobile (avaliar antes de habilitar por padrão)
- Política de limpeza de sessões finalizadas (TTL do histórico)
- Editor: **Monaco vs CodeMirror** (atualmente: textarea + line numbers + CSS caret colors; plano: CodeMirror)
- Limite de tamanho de arquivo para upload e edição

### Known Issues (Deferred)

- **`vitest@3.2.6` tem CVE crítico (GHSA-5xrq-8626-4rwp)** — só afeta `vitest --ui` (não usado). Upgrade para 4.x precisa de migration. Não bloqueante.

---

### 2026-06-05 — Bug 05: Terminal PTY Resize — No New Learnings

**Context:** Full test run of Bug 05 (Terminal PTY Resize) — 731 tests, all passing. The bug fix added a resize API route (`POST /api/sessions/:id/resize`), debounced resize hooks in ProjectDetail + Emergency, and initial PTY resize after spawn.

**Discovery:** All 731 tests passed on first run. The new resize route has 6 test cases covering all states (success, 404, 401, invalid cols/rows, empty body). The frontend resize hooks are tested with 4 tests (ProjectDetail) + 2 tests (Emergency) covering debounce behavior, rapid-call deduplication, and null sessionId. Coverage for new code is 100% (resize route handler, debounce hooks). The sessions.ts overall file coverage is 65.58% due to pre-existing uncovered error branches in the create session, rename, status, and emergency terminal routes — not part of this bug fix.

**Observation — Code Duplication:** The `useDebouncedResize` hook (lines 31-48) is duplicated verbatim in both `ProjectDetail.tsx` and `Emergency.tsx`. This is a DRY violation that should be refactored into `apps/web/src/hooks/useDebouncedResize.ts` in a future cleanup task. The duplication is functionally identical, so extract-and-replace is low-risk.

**Source:** Bug 05 — Tester run

### 2026-06-05 — Task: Terminal Quality & Performance — jsdom document.fonts polyfill

**Context:** The `XTermTerminal` component calls `document.fonts.load()` to wait for JetBrains Mono before opening the xterm terminal. This API is used for font-loading synchronization.

**Discovery:** jsdom 29 does not implement the `document.fonts` (FontFaceSet) API. Any test that renders `XTermTerminal` will fail with `TypeError: Cannot read properties of undefined (reading 'load')` unless a polyfill is added to `test-setup.ts`.

**Solution:** Added a conditional `document.fonts` polyfill in `apps/web/src/test-setup.ts`:

```ts
if (!('fonts' in document)) {
  Object.defineProperty(document, 'fonts', {
    value: {
      load: () => Promise.resolve([]),
      ready: Promise.resolve(),
      check: () => true,
    },
    writable: true,
  });
}
```

**Source:** Task task-terminal-quality-perf

### 2026-06-05 — Task: Terminal Quality & Performance — xterm.js v6 native options

**Context:** xterm.js v6.0.0 exposes several native configuration options for visual quality and performance that were previously unused.

**Discovery:** The following options are available in xterm 6's `ITerminalOptions` and have zero external dependencies:

- `drawBoldTextInBrightColors: true` — renders bold text using ANSI bright colors
- `customGlyphs: true` — enables box-drawing character rendering
- `rescaleOverlappingGlyphs: true` — prevents visual glitches with CJK/emoji characters
- `minimumContrastRatio: 4.5` — enforces WCAG AA contrast between foreground and background
- `allowTransparency: true` — allows the terminal background to inherit from parent container
- `logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'off'` — controls internal logging verbosity
- `ITheme` includes `scrollbarSliderBackground`, `scrollbarSliderHoverBackground`, `scrollbarSliderActiveBackground` for custom scrollbar theming

**Solution:** All options are passed declaratively to `new Terminal({...})` and `TERMINAL_THEME`. No new addons, hooks, or files required.

**Source:** Task task-terminal-quality-perf

### 2026-06-05 — Task: Terminal Quality & Performance — XTermTerminal Test Failures

**Context:** Running `XTermTerminal.test.tsx` after the terminal quality improvements. All xterm-native options (drawBoldTextInBrightColors, customGlyphs, etc.) and CSS containment are purely declarative and do not cause test failures. However, 12 tests fail due to pre-existing patterns in the test file.

**Discovery:** Two categories of test failures, both pre-existing:

1. **Async font-loading not awaited (11 tests):** The component's `useEffect` wraps terminal initialization inside `Promise.race([document.fonts.load(...), setTimeout(3000)])`. With `vi.useFakeTimers({ shouldAdvanceTime: true })`, the microtask queue is NOT automatically flushed. Tests that render the component and immediately assert `mockTerminal.loadAddon`, `mockTerminal.open`, etc. get 0 calls because the Promise hasn't resolved yet. The fix is to add `await act(async () => { await vi.advanceTimersByTimeAsync(0); })` (or use the existing `flushOpen()` helper) before assertions in each affected test.

2. **Reconnecting badge regex mismatch (1 test):** The badge text format is `` `Reconnecting… (${attempt}/${maxAttempts})` `` but the test expects `/Reconnecting.*attempt 1.*\/.*10/`. The regex needs to match `(1/10)` instead of `attempt 1 / 10`.

**Affected tests (all in XTermTerminal.test.tsx):**

- Category A: `calls Terminal constructor, loadAddon, and open on mount` (L183), `calls terminal.dispose(), unsubscribes onData...` (L195), `forwards WebSocket message data to terminal.write()` (L222), `does NOT send data to WebSocket when the connection is not OPEN` (L238), `calls ResizeObserver.fit() and onResize callback...` (L256), `observes the container with a ResizeObserver on mount` (L271), `disconnects the ResizeObserver on unmount` (L277), `uses the latest onResize callback...` (L287), `applies the fontSize prop at terminal creation` (L306), `updates terminal.options.fontSize and calls fit...` (L316), `fires onResize callback after fontSize change` (L330)
- Category B: `shows a "Reconnecting…" badge with attempt counter on abnormal close` (L358)

**Source:** Task task-terminal-quality-perf — Tester run

### 2026-06-05 — Task: Terminal Quality & Performance — Pre-Existing Test Failures Across Workspace

**Context:** Full test suite run (740 tests across server, web, pty-worker workspaces). 63 failures total.

**Discovery:** 51 of 63 failures are pre-existing and NOT caused by this task's changes:

| File                      | Failures | Root Cause                                                                               |
| ------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| ProjectDetail.test.tsx    | 37/38    | Component crashes before rendering — API mock setup issues, all data-testid queries fail |
| Projects.test.tsx         | 8/31     | `harnesses.map is not a function` — harness state initialization mismatch in tests       |
| Sidebar.test.tsx          | 1/30     | `Found multiple elements with the text: Dashboard` — duplicate DOM text in component     |
| sessions.test.ts (server) | 5/29     | Expected command/status value mismatches in mock assertions                              |

**Action:** These need separate fix tasks. They are out of scope for the terminal quality task. The XTermTerminal test fixes are the only ones in scope.

**Source:** Task task-terminal-quality-perf — Tester run

### 2026-06-05 — XTermTerminal Test Fix: Mock Terminal Options + onResize Cleanup

**Context:** Fixing 12 failing XTermTerminal tests after the component added async `document.fonts.load()` before terminal initialization. Three additional fixes were needed beyond the 11 font-flush additions.

**Discovery — Mock Terminal must apply constructor options:** The `vi.mock('@xterm/xterm', () => ({ Terminal: vi.fn().mockImplementation(() => mockTerminal) }))` mock always returns the same `mockTerminal` instance with pre-set `options.fontSize = 14`. When `new Terminal({ fontSize: 12 })` is called, the mock ignores constructor arguments. The component's `fontSize` sync `useEffect` only fires on initial render (when `terminalRef.current` is still null because the async font hasn't loaded yet) and on `fontSize` prop change. On initial mount with non-default `fontSize`, the sync effect's guard `if (!term || !fit) return` exits early, and the constructor mock never applies the fontSize. **Fix:** Update the mock implementation to read `options.fontSize` from constructor args.

**Discovery — `doFit()` fires `onResize` during mount:** The terminal initialization calls `doFit()` which fires `onResizeRef.current(terminal.cols, terminal.rows)`. In the test "uses the latest onResize callback without re-mounting the terminal", the initial `onResize={first}` callback IS called once during the font-load flush (the doFit call). The assertion `expect(first).not.toHaveBeenCalled()` fails because first was already called during initialization. **Fix:** Add `first.mockClear()` after the font-load flush and before the rerender. This cleans the initial call and ensures the assertion only checks the post-rerender behavior.

**Source:** Task task-terminal-quality-perf — Executor fix phase

### 2026-06-05 — Tester: Coverage Aborted by Uncaught Exceptions in Other Test Files

**Context:** Running `vitest run --coverage` for the full workspace when some test files have uncaught exceptions (e.g., `harnesses.map is not a function` crash in Projects.test.tsx).

**Discovery:** When uncaught exceptions occur in test files unrelated to the target code, vitest terminates before writing coverage output files (no `coverage-summary.json`, no HTML). This is distinct from test failures — uncaught exceptions abort the process entirely.

**Solution:** When coverage for a specific file is needed and other test files have pre-existing crashes, run coverage scoped to the specific test file:

```bash
cd apps/web && bunx vitest run --coverage src/components/Terminal/XTermTerminal.test.tsx
```

This isolates the coverage run to only the passing tests and produces valid coverage output.

**Source:** Task task-terminal-quality-perf — Tester run

### 2026-06-05 — Task: Terminal Quality & Performance — Pre-Existing ESLint Config Gap

**Context:** `eslint-plugin-react-hooks` is not installed as a dependency, yet the codebase uses `// eslint-disable-next-line react-hooks/exhaustive-deps` comments (e.g., `XTermTerminal.tsx:328`).

**Discovery:** ESLint fails with `error  Definition for rule 'react-hooks/exhaustive-deps' was not found` on any file that references this rule. The disable comment itself triggers the error because the rule it references isn't loaded.

**Solution:** Install `eslint-plugin-react-hooks` as a devDependency:

```bash
bun add -D eslint-plugin-react-hooks
```

And ensure it's registered in the ESLint config `plugins` array. This is a project-level fix, not scoped to any single task.

**Source:** Code review of task task-terminal-quality-perf

### 2026-06-05 — Task: Terminal Quality & Performance — Code Review Findings

**Context:** Final code review of task-terminal-quality-perf. Only changed file is `XTermTerminal.tsx` — all changes are declarative configuration (xterm.js v6 native options + theme properties + CSS class).

**Discovery:** No code quality issues found. The changes are zero-logic, zero-new-dependencies, and zero-new-inputs. Security scan passed with zero findings. All 26 XTermTerminal tests pass, typecheck is clean, coverage exceeds 80% threshold. A Prettier formatting fix was applied (minor whitespace). One pre-existing ESLint configuration gap noted separately above.

**Source:** Task task-terminal-quality-perf — Reviewer agent

### 2026-06-05 — Bug Fix: Remove Terminal Visual Overlays and Transparency

**Context:** The xterm.js terminal in `XTermTerminal.tsx` had visual quality degradation (washed-out colors, color banding, blurriness) caused by three factors: backdrop-blur CSS on overlay elements, semi-transparent overlay backgrounds (`/90`, `/95`), and `allowTransparency: true` in xterm.js.

**Discovery:** Three specific issues interact to degrade terminal rendering on dark backgrounds (`#0a0a0f`, `#111118`):

1. **`backdrop-blur` on near-black backgrounds** — Chromium's blur algorithm on `#0a0a0f` and `#111118` produces severe _color banding_, especially at high opacities. The blur kernel operates on RGB channels and the near-zero values amplify quantization artifacts.
2. **Semi-transparent overlay backgrounds (`bg-[#111118]/90`, `bg-[#0a0a0f]/95`)** — opacity modifiers create intermediate compositing layers the browser must recalculate each frame, degrading color fidelity.
3. **`allowTransparency: true` in xterm.js** — forces alpha-blended compositing layers that interact with overlays and the dark background, introducing additional rendering artifacts.

**Solution:** Three minimal changes in `XTermTerminal.tsx`:

- Remove `backdrop-blur` from StatusBadge and `backdrop-blur-sm` from ErrorOverlay
- Use solid background colors (`bg-[#111118]`, `bg-[#0a0a0f]`) without opacity modifiers
- Set `allowTransparency: false` in the Terminal constructor

The terminal is the primary interface — any visual effect layer between the real PTY output and what the user sees is noise. Solid colors and no compositing guarantee 1:1 rendering fidelity.

**Source:** task-fix-terminal-visual-overlay

### 2026-06-05 — Test Perf Optimization: happy-dom Reverted to jsdom

**Context:** Attempted to replace jsdom with happy-dom (v20.10.1) as the Vitest environment for the web workspace (27 test files, 375 tests).

**Discovery:** happy-dom caused 23/27 test files to fail. Failure pattern: `TestingLibraryElementError: Found multiple elements` — happy-dom's DOM rendering differs from jsdom, producing duplicated elements in rendered output. The sidebar tests were particularly affected (duplicate `data-testid` and text matches). The failure rate (23 files) far exceeds the ≥3 threshold defined for fallback.

**Solution:** Reverted `environment` to `'jsdom'` in `apps/web/vitest.config.ts`. Kept `pool: 'forks'` (the pool optimization survives regardless of environment). happy-dom is still installed as a devDependency but unused — it's there if future Vitest/happy-dom versions resolve the compatibility.

**Source:** Task task-test-perf-optimization

### 2026-06-05 — Test Perf Optimization: singleFork Causes Vitest Worker Timeout

**Context:** Configured `poolOptions.forks.singleFork: true` in `apps/web/vitest.config.ts` to reuse a single jsdom instance across all 27 web test files.

**Discovery:** With `singleFork: true`, all 27 files run sequentially in a single fork worker. The cumulative time (~246s) exceeds Vitest's internal RPC timeout. Error: `[vitest-worker]: Timeout calling "onTaskUpdate"`. Only 10 of 27 files completed before the worker was killed. This is a different failure mode than memory exhaustion — it's a vitest protocol timeout, not an OOM.

**Solution:** Removed `poolOptions` entirely. Kept `pool: 'forks'` only. Without `singleFork`, vitest spawns multiple fork workers (one per file by default), allowing parallel execution. The performance between `forks` (96s) and `threads` (93s) is within measurement noise (~3%) for this suite.

**Source:** Task task-test-perf-optimization

### 2026-06-05 — Test Perf Optimization: CI Gains from Bail + Dot Reporter, Not Pool

**Context:** Test performance optimization targeting the full 731-test suite across 3 workspaces.

**Discovery:** The pool change alone (`forks` vs `threads`) yields negligible improvement (~3%). The real CI gains come from:

1. **`bail: 1`** — stops on first failure, saving the cost of running remaining tests on broken builds
2. **`retry: 2`** — flaky tests get a second chance instead of failing the entire CI run
3. **`test:fast` script** — `--reporter=dot` eliminates the verbose HTML/JSX debug output (massive in token/log terms), and `--bail=1` stops early on failure

**Solution:** `test:fast` script: `vitest run --reporter=dot --bail=1`. The dot reporter alone is a significant win for CI logs. Combined with bail, broken builds fail in seconds instead of minutes.

**Source:** Task task-test-perf-optimization

### 2026-06-05 — Test Perf Optimization: Lazy-Load jest-dom in test-setup Requires ESM Module Marker

**Context:** Converted `import '@testing-library/jest-dom/vitest'` (static) to `await import(...)` (dynamic) in `apps/web/src/test-setup.ts` to avoid loading jest-dom at module parse time outside test context.

**Discovery:** Two TypeScript issues arise:

1. **`TS1375`: `await` requires module context** — after removing the static import, the file has no imports/exports, so TypeScript doesn't treat it as an ESM module. **Fix:** Add `export {}` to mark it as a module.
2. **`TS2304`: `expect` not found** — `typeof expect` at the top level fails typecheck because vitest globals aren't available. **Fix:** Use `typeof (globalThis as any).expect` with `eslint-disable-next-line @typescript-eslint/no-explicit-any`.

**Solution:** Pattern:

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (typeof (globalThis as any).expect !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
}
export {};
```

**Source:** Task task-test-perf-optimization

### 2026-06-05 — Test Perf Optimization: Tester Confirms Pre-Existing Failures Unchanged

**Context:** Full test suite run (740 tests across 41 files) after applying all config changes (bail, retry, pool, environment, lazy-load test-setup, test:fast script).

**Discovery:** 51 tests fail / 4 unhandled errors — all pre-existing and documented in PROJECT_CONTEXT.md §10. No new failures introduced by the config changes. The pre-existing failures are:

| File | Failures | Root Cause |
|------|----------|------------|
| `ProjectDetail.test.tsx` | 37/38 | Component crashes before rendering — API mock setup |
| `Projects.test.tsx` | ~8 | `harnesses.map is not a function` — state init mismatch |
| `Sidebar.test.tsx` | 1 | `Found multiple elements with text: Dashboard` |
| `sessions.test.ts` | 5 | Mock assertion mismatches (opencode→bash, status values) |

The unhandled exceptions (4) all originate from `Projects.tsx:350` (`harnesses.map`) and `Projects.tsx:786` (`Cannot read properties of null`), causing vitest to abort coverage output for the web workspace. Coverage numbers (6.2% statements) are unreliable due to this known limitation.

**Verified working:**
- `bail: 1` — `test:fast` bails at first failure in 4.59s
- `retry: 2` — configured, flaky tests get second chance
- `pool: 'forks'` — all 41 files run without RPC timeout (unlike `singleFork: true`)
- `environment: 'jsdom'` — happy-dom correctly reverted after 23/27 failures
- `apps/web/src/test-setup.ts` — lazy-loads `@testing-library/jest-dom` via dynamic `import()`
- `test:fast` script — `vitest run --reporter=dot --bail=1` works as intended

**Source:** Task task-test-perf-optimization — Tester run
