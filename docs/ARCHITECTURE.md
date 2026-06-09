# OpenCode Dashboard — Documentação de Arquitetura

> Última atualização: 2026-06-05
> Versão do projeto: 1.0.0 (monorepo Bun workspaces)

Este documento descreve **como o sistema funciona por dentro**, com foco em:

- Topologia geral (3 processos, IPC, WebSocket, DB)
- Manipulação das sessões de terminal (são permanentes? como? quando morrem?)
- Modelo de dados completo e o que é persistido no SQLite vs o que vive em memória

Para a visão de produto / stack / decisões, ver `PROJECT_CONTEXT.md`. Para deploy, ver `docs/deploy.md`.

---

## 1. Visão geral em 1 minuto

O sistema é um **monorepo com 3 aplicações Bun workspaces** que se conversam:

```
┌─────────────────────────────────────────────────────────────────┐
│                          Browser (mobile/desktop)               │
│  React 19 + Vite 6 + Tailwind v4 + xterm.js v6                  │
│  - Pages: Login, Dashboard, Projects, ProjectDetail, Kanban,    │
│           Emergency                                             │
│  - Hooks: useSessions, useTerminalSocket                        │
└──────────────┬──────────────────────────────────┬────────────────┘
               │ HTTPS REST (JWT)                 │ WSS (xterm stream)
               │ Authorization: Bearer <jwt>      │ ws(s)://host/terminal/<sid>
               ▼                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│  apps/server  —  Bun 1.x + Elysia 1.4                           │
│  ────────────────────────────────────────────────────────────   │
│  • HTTP/REST:  /api/auth/*  /api/projects/*  /api/sessions/*    │
│                /api/tasks/*  /api/files/*  /api/resources/*     │
│                /api/agents/*  /api/harnesses  /api/github/*     │
│  • WebSocket:  /terminal/:sessionId    (Elysia WS nativo)       │
│  • Auth:       JWT HS256 (jose) — senha única do .env           │
│  • DB:         bun:sqlite (./data/opencode.db, WAL mode)         │
│  • Orchestrator: PtyManager (Map de sessões + worker IPC)        │
└──────────────┬──────────────────────────────────────────────────┘
               │ stdio JSON-lines (line-delimited IPC)
               │ /usr/bin/nodejs  +  tsx  +  apps/pty-worker/src/index.ts
               ▼
┌─────────────────────────────────────────────────────────────────┐
│  apps/pty-worker  —  Node 18 LTS + node-pty 1.1                 │
│  ────────────────────────────────────────────────────────────   │
│  • Map<sessionId, IPty>  (processos PTY reais)                  │
│  • readline loop no stdin → handlers → stdout JSON               │
│  • fork-and-isolate: contorna incompatibilidade node-pty × Bun   │
└─────────────────────────────────────────────────────────────────┘
```

**Por que 3 processos?** O `node-pty@1.1.0` chama `uv_version_string` durante o init do N-API — função libuv **ainda não implementada** no Bun 1.3.14 (issue oven-sh/bun#18546). O prebuild do `node-pty` foi compilado contra a ABI do Node 18 (`libnode.so.109`), então o worker precisa rodar **Node 18 LTS** (em produção: o `nodejs` do apt em Ubuntu 24.04 = v18.19.1). O resto do stack fica em Bun. Toda comunicação entre Bun e Node acontece via **stdio JSON-lines**.

---

## 2. Topologia dos processos

### 2.1 Boot do servidor (sequência exata)

`apps/server/src/index.ts:140` orquestra o startup. A ordem importa:

1. **`validateAuthEnv()`** — falha imediata (`process.exit(1)`) se `AUTH_PASSWORD` ou `JWT_SECRET` não estiverem no `.env`.
2. **`initDb()`** — abre `./data/opencode.db` via `bun:sqlite`, força `PRAGMA journal_mode = WAL` e `PRAGMA foreign_keys = ON`, e executa `schema.sql` (idempotente — usa `CREATE TABLE IF NOT EXISTS`).
3. **`scanResources()`** — varre `~/.config/opencode/{skills,agents,mcps}/` e popula o cache em memória. Falha é não-fatal.
4. **Sobe o Elysia** registrando todos os grupos de rotas (`.use(authRoutes, projectsRoutes, ...)`).
5. **`app.listen(3001)`** — só então:
   - **`getPtyManager().startStatusMonitor(1000)`** — inicia o poller que detecta transições de status das PTYs a cada 1s.
   - **`startGithubPolling()`** — agenda o sync de GitHub issues a cada 5 min.

### 2.2 Quem fala com quem

| Origem → Destino        | Protocolo                  | Payload                                                       | Onde está definido                              |
| ----------------------- | -------------------------- | ------------------------------------------------------------- | ----------------------------------------------- |
| Browser → Elysia        | HTTPS + JWT                | `GET/POST/PUT/DELETE /api/*`                                  | `apps/server/src/routes/*`                      |
| Browser → Elysia        | WebSocket                  | frames texto (xterm) + JSON `{type,code}` para exit/status    | `apps/server/src/ws/handler.ts:241`             |
| Elysia → pty-worker     | stdio pipes (stdin/stdout) | JSON-lines (1 msg = 1 linha)                                  | `apps/server/src/pty/transport.bun.ts:60`       |
| Elysia → pty-worker     | subprocess spawn           | `Bun.spawn([node18, tsx, workerSrc])`                         | `apps/server/src/pty/transport.bun.ts:60`       |
| pty-worker → Elysia     | stdio pipes                | JSON-lines de `data`/`spawned`/`exit`/`killed`/`list`/`error` | `apps/pty-worker/src/protocol.ts:75`            |
| Elysia → SQLite         | in-process (bun:sqlite)    | SQL via `db.query()` / `db.run()`                             | `apps/server/src/db/client.ts`                  |
| pty-worker → Node child | `node-pty` fork/exec       | streams TTY                                                   | `apps/pty-worker/src/index.ts:129` (`ptySpawn`) |
| Elysia → GitHub         | HTTPS REST v3              | issues + labels (token opcional)                              | `apps/server/src/routes/github.ts:41`           |

---

## 3. Manipulação das sessões de terminal

Esta é a parte central do produto. As sessões PTY são **long-lived** mas **não persistidas em SQLite** — vivem em memória nos dois processos (Bun e Node).

### 3.1 São permanentes? Resposta curta

**Não.** As sessões são **voláteis por design** (decisão consciente do Sprint 2, registrada em `sessions.ts:8-13`):

> _"Persistence is intentionally NOT in scope for Sprint 2: session metadata is in-memory only and resets on server restart. SQLite persistence will be added in a later sprint if needed."_

Concretamente:

| Cenário                                      | O que acontece com a sessão?                                                                                                                                                                                                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Usuário fecha a aba do browser               | **Continua viva** — PTY não é morta; buffer (~10 KB de output) fica retido para reconexão.                                                                                                                                                                                    |
| Usuário abre nova aba e reconecta            | Servidor envia o buffer acumulado; xterm.js pinta o estado anterior.                                                                                                                                                                                                          |
| Usuário faz `DELETE /api/sessions/:id`       | PTY é morta (`SIGKILL` via worker), entrada do metadata removida.                                                                                                                                                                                                             |
| Servidor reinicia (deploy, crash, reboot)    | **Tudo morre.** O Node worker (e todos os processos `opencode`/`bash` que ele forkou) é encerrado. O Bun reinicia, o PtyManager recria um Map vazio, o worker Node é re-spawnado limpo. SQLite retém apenas `projects`, `tasks` e `project_resources` — nada da sessão em si. |
| PTY encerra sozinha (comando `exit`, SIGHUP) | Status vira `exited` ou `killed`. Sessão fica listada como "finalizada" por até 5 min (Agentes Panel) e o buffer é mantido para visualização, mas o processo já morreu.                                                                                                       |

### 3.2 O que existe em cada camada

```
                          ┌──────────────────────────────┐
                          │  apps/server (Bun)           │
   SQLite (./data/opencode.db)                          │
   ──────────────────────  │  • Map<id, SessionMeta>      │  ← in-memory
   projects                │     { sessionId, projectId,  │
   project_resources       │       name, status, type,    │
   tasks                   │       createdAt }            │
   _migrations             │  • PtyManager                │
                          │     Map<id, SessionState> {  │
                          │       id, cwd, command, args,│
                          │       pid, buffer (10KB),    │
                          │       status, dataAt,        │
                          │       3 Sets<callback> }     │
                          └────────┬─────────────────────┘
                                   │ stdio JSON-lines IPC
                                   ▼
                          ┌──────────────────────────────┐
                          │  apps/pty-worker (Node 18)   │
                           │  • Map<id, IPty>             │  ← processos reais
                           │  • readline único no stdin   │  ← 1 loop de IPC para todas as PTYs
                          └────────┬─────────────────────┘
                                   │ node-pty.fork/exec
                                   ▼
                          ┌──────────────────────────────┐
                          │  processos filhos reais      │
                          │  opencode  |  bash           │
                          │  (cwd = project.directory    │
                          │   OU /root p/ emergência)    │
                          └──────────────────────────────┘
```

### 3.3 Ciclo de vida completo (passo a passo)

#### Spawn (criação)

1. Frontend chama `POST /api/projects/:id/sessions` (autenticado, `authGuard`).
2. Handler em `apps/server/src/routes/sessions.ts:108`:
   - Valida projeto no SQLite (`SELECT * FROM projects WHERE id = ?`).
   - Verifica que `project.directory` ainda existe em disco.
   - Conta sessões ativas para emitir **soft-limit warnings** (>10 totais, >5 por projeto) — não bloqueia.
   - Gera `sessionId = crypto.randomUUID()` e nome (`Sessão N` sequencial por projeto, ou nome custom).
   - **Reserva o slot em `sessionMeta`** (Map em memória) **antes** de spawnar — se a PTY falhar, o slot é revertido no `catch`.
   - Coleta recursos ativos do projeto via `getActiveResourcesForProject(projectId)` (`project_resources` ⋈ cache de scan) e monta env vars `OPENCODE_ACTIVE_SKILLS`, `OPENCODE_ACTIVE_AGENTS`, `OPENCODE_ACTIVE_MCPS`.
   - Chama `getPtyManager().spawnSession(sessionId, directory, 'bash', ['-c', 'opencode; exec bash'], extraEnv)`.
   - O comando `bash -c 'opencode; exec bash'` é usado intencionalmente: se `opencode` não estiver instalado no host (comum em dev), o shell imprime "command not found" e executa `bash` em seguida — a sessão permanece funcional. O `exec bash` após `opencode` também garante que um Ctrl+C (SIGINT) no opencode apenas encerra o agente e abre um shell interativo, mantendo a sessão viva.
   - Agenda um `resize(120, 35)` 200 ms depois (padrão de visualização confortável).
   - Registra `onSessionExit` que faz `m.status = 'exited'` no metadata.
3. `PtyManager.spawnSession` (`apps/server/src/pty/manager.ts:158`):
   - Cria `SessionState` com `status: 'pending'`, `buffer: ''`, 3 Sets vazios de callbacks.
   - Insere no `sessions` Map.
   - Envia `{type:'spawn', id, cwd, command:'bash', args:['-c','opencode; exec bash'], env}` pelo transport (linha JSON no stdin do worker Node).
   - Retorna Promise que resolve com o `pid` quando o worker responder `spawned` (timeout 5s).
4. `BunWorkerTransport.send` (`apps/server/src/pty/transport.bun.ts:87`) escreve `JSON.stringify(msg) + '\n'` no stdin do worker.
5. `startIpcLoop` no worker (`apps/pty-worker/src/index.ts:232`) lê a linha, valida, despacha para `handleMessage` → `handleSpawn`.
6. `handleSpawn` (`apps/pty-worker/src/index.ts:114`):
   - Faz merge de `process.env` com `msg.env` recebido.
   - Chama `pty.spawn(command, args, {name:'xterm-color', cols, rows, cwd, env})`.
   - Grava o `IPty` no `sessions` Map do worker.
   - Liga `proc.onData(chunk => write({type:'data', id, chunk: Buffer.from(chunk,'binary').toString('base64'), encoding:'base64'}))` — todo output do PTY é codificado em base64 para preservar bytes binários através da camada JSON-lines.
   - Liga `proc.onExit(({exitCode, signal}) => write({type:'exit', id, code}))`.
   - Responde `{type:'spawned', id, pid}` imediatamente.
7. `PtyManager.onSpawned` resolve a Promise com o `pid` e marca `session.status = 'active'`.

#### Conexão WebSocket do browser

1. Frontend instancia `useTerminalSocket(sessionId)` em `apps/web/src/hooks/useTerminalSocket.ts:141`.
2. Hook abre `ws(s)://<host>/terminal/<sessionId>` (Vite proxy em dev, nginx em prod).
3. `Elysia.ws('/terminal/:sessionId', ...)` em `apps/server/src/ws/handler.ts:241` chama `handleOpen` (linha 111):
   - **4044 close** se a sessão não existe no PtyManager (`sessionExists` faz um write zero-byte e captura a throw).
   - **4044 close** se a sessão já está `exited`/`killed`.
   - Envia o **buffer acumulado** (até 10 KB) ao cliente — `ws.send(buffer)`. É o "replay" que reconstitui o histórico no xterm.js.
   - Registra 3 callbacks no `SessionState`:
     - `dataCb`: encaminha `chunk` para o `ws.send(chunk)` do cliente.
     - `exitCb`: envia `{type:'exit', code}` + `ws.close()`.
     - `statusCb`: envia `{type:'status', status}` quando o monitor de status mudar.
   - Adiciona a `entry` em `connectedClients: Map<sessionId, Set<ClientEntry>>` (suporta múltiplas abas).

#### Operação normal (streaming bidirecional)

- **Browser → PTY**: `terminal.onData` no xterm.js → `socket.send(data)` → `handleMessage` no servidor → `getPtyManager().writeToSession(sessionId, data)` → transport → worker → `proc.write(data)`.
- **PTY → Browser**: `proc.onData(chunk)` no worker → `write({type:'data', id, chunk})` → stdout → `BunWorkerTransport.readStdoutLoop` parseia a linha → `PtyManager.onData` → adiciona ao buffer circular (slice dos últimos 10 KB) → itera `dataCallbacks` → `ws.send(chunk)` para cada cliente conectado.
- **Resize**: frontend dispara `POST /api/sessions/:id/resize {cols, rows}` (debounced em `useDebouncedResize`) → `manager.resizeSession` → worker → `proc.resize(cols, rows)` → o processo filho recebe `SIGWINCH` e re-renderiza.

#### Detecção de status (1 Hz)

`PtyManager.startStatusMonitor(1000)` (`apps/server/src/pty/manager.ts:313`) cria um `setInterval` que:

1. Para cada sessão em `this.sessions`, chama `detectStatus(session)` (`apps/server/src/pty/detector.ts:72`).
2. `detectStatus` retorna:
   - **`finished`** se `status === 'exited' || 'killed'`.
   - **`waiting`** se o buffer (com ANSI stripado) termina com padrão `user@host:~/path$` (regex `OPENCODE_PROMPT_REGEX`).
   - **`active`** caso contrário.
3. Compara com `lastDetectedStatus.get(id)`. Se mudou, dispara todos os `statusCallbacks` registrados.

Esse status é o que aparece no **Agentes Panel** (`/api/agents`) e nos badges de UI.

#### Cleanup (matar sessão)

1. `DELETE /api/sessions/:id` → `manager.killSession(sessionId)` (`manager.ts:215`).
2. Envia `{type:'kill', id}` ao worker; resolve Promise em `{type:'killed', id}`.
3. Worker: `proc.kill()` + remove do Map local.
4. Manager: `session.status = 'killed'`, dispara `exitCallbacks` (mas o `pty.onExit` também vai disparar em paralelo — o status acaba confirmado como `exited`).
5. **Importante**: o manager **não deleta a sessão em memória no exit** (`manager.ts:432` — comentário: _"we intentionally do NOT delete the session on exit. The buffer must survive so reconnections can replay the last output."_). A entrada fica lá até o servidor reiniciar.
6. Mas: rotas como `GET /api/projects/:id/sessions?status=active` filtram para esconder `exited`/`killed` do usuário comum; o `agents` panel esconde sessões finalizadas há mais de 5 minutos.

#### Desconexão de cliente ≠ morte de PTY

Quando o browser fecha a aba (`ws.onclose`):

- `handleClose` (`ws/handler.ts:218`) remove **apenas os callbacks deste cliente** dos `Sets` do PtyManager (`removeSessionData`, `removeSessionExit`, `removeSessionStatus`).
- O `IPty` continua rodando.
- A próxima aba que abrir verá o buffer intacto.

#### Crash do worker (anormal)

`BunWorkerTransport` monitora `proc.exited` (`transport.bun.ts:77`):

- `PtyManager.handleWorkerExit(code)` marca **todas** as sessões ativas como `exited`, dispara `exitCallbacks` com sentinel `-1` (não foi um exit limpo), rejeita todas as Promises pendentes.
- O `BunWorkerTransport` não respawna sozinho — o manager fica em estado degradado até o servidor reiniciar.

---

## 4. Protocolo IPC (Bun ↔ Node worker)

Definido em `apps/pty-worker/src/protocol.ts` e consumido em ambos os lados.

### 4.1 Framing

- **stdin** (Bun → Node): uma mensagem JSON por linha, terminada em `\n`.
- **stdout** (Node → Bun): idem.
- **stderr** (Node): texto livre, o `BunWorkerTransport` faz `process.stderr.write('[pty-worker] ${text}')` — útil para debug, ignorado pelo manager.

### 4.2 Mensagens (Bun → Node)

| Tipo       | Campos                                        | Correlação                              |
| ---------- | --------------------------------------------- | --------------------------------------- |
| `spawn`    | `id, cwd, command, args?, cols?, rows?, env?` | resposta: `spawned` com mesmo `id`      |
| `write`    | `id, data`                                    | fire-and-forget (sem resposta)          |
| `resize`   | `id, cols, rows`                              | fire-and-forget                         |
| `kill`     | `id`                                          | resposta: `killed` com mesmo `id`       |
| `list`     | —                                             | resposta: `list { sessions: string[] }` |
| `shutdown` | —                                             | o worker faz `process.exit(0)`          |

### 4.3 Mensagens (Node → Bun)

| Tipo      | Campos               | Significado                                                                         |
| --------- | -------------------- | ----------------------------------------------------------------------------------- |
| `spawned` | `id, pid`            | PTY criada com sucesso                                                              |
| `data`    | `id, chunk, encoding?` | Output do PTY codificado em **base64** (`encoding: 'base64'`) — preserva bytes binários (ANSI, UTF-8 multi-byte) sem corrupção na camada JSON → stdio |
| `exit`    | `id, code`           | Processo encerrou (code = 0 limpo, >0 erro, 128+N signal N)                         |
| `killed`  | `id`                 | Confirmação do `kill`                                                               |
| `list`    | `sessions: string[]` | IDs ativos no worker                                                                |
| `error`   | `id?, message`       | Erro (esperado ou exceção). `id` presente quando a falha é em uma sessão específica |

### 4.4 Correlação de requests

- `spawn` e `kill` são **awaitable** — o manager guarda `pendingSpawns: Map<id, Promise>` e `pendingKills: Map<id, Promise>`. Timeout padrão **5 s** (configurável via `PtyManagerOptions.timeoutMs`).
- `list` é **single-flight** — `pendingList: Promise | null` (apenas um em vôo por vez).
- `write` e `resize` são **fire-and-forget** — `BunWorkerTransport.send` retorna imediatamente; erros de I/O no stdin são logados e descartados.
- O **id do request = id da sessão** — usado para multiplexar várias PTYs no mesmo pipe stdio.

### 4.5 Resiliência

- **JSON inválido** do worker: `BunWorkerTransport.readStdoutLoop` loga e continua (`transport.bun.ts:162`).
- **Read error** do stdout: loga e sai do loop silenciosamente.
- **Stderr do worker**: pipeado para `process.stderr` do servidor com prefixo `[pty-worker]`.
- **Shutdown gracioso**: `BunWorkerTransport.shutdown` (`transport.bun.ts:109`):
  1. Tenta enviar `{type:'shutdown'}` pelo stdin.
  2. `Promise.race` entre `proc.exited` e `setTimeout(2000)`.
  3. Se não morreu sozinho, `proc.kill()`.

---

## 5. Modelo de dados — o que está no SQLite

O banco é **`./data/opencode.db`** (configurável via `DATABASE_PATH`), com `journal_mode = WAL` (gera `opencode.db-wal` e `opencode.db-shm` ao lado — ambos já no `.gitignore`).

### 5.1 Tabelas existentes (em `schema.sql`)

#### `_migrations` — controle de migrations

```sql
CREATE TABLE _migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT DEFAULT (datetime('now'))
) STRICT;
```

> Nota: a tabela existe, mas o `initDb()` atual **não popula** automaticamente — é reservada para um futuro runner. Hoje o `schema.sql` é aplicado na íntegra a cada boot (idempotente). Está vazia no DB de exemplo.

#### `projects` — diretórios registrados pelo usuário

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,                  -- UUID v4
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  directory TEXT NOT NULL,              -- path absoluto (validado em runtime)
  description TEXT,
  harness_id TEXT,                      -- soft ref (sem FK até sprint 7)
  github_repo TEXT,                     -- formato "owner/repo"
  created_at TEXT NOT NULL,             -- ISO 8601 (datetime('now'))
  updated_at TEXT NOT NULL
) STRICT;
```

**Constraints notáveis**: `UNIQUE COLLATE NOCASE` no `name` torna nomes case-insensitive no DB; o handler `POST /api/projects` reforça isso no app layer (`WHERE name = ? COLLATE NOCASE` → 409). `directory` é validado por `validateDirectory` (deve existir em disco e ser absolutizado via `resolve()`).

#### `project_resources` — ativação de skills/agents/MCPs por projeto

```sql
CREATE TABLE project_resources (
  project_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,            -- "skill:name" | "agent:name" | "mcp:name"
  active INTEGER NOT NULL DEFAULT 1,    -- 0 ou 1 (SQLite não tem boolean)
  PRIMARY KEY (project_id, resource_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) STRICT;
```

**Uso**: o handler de spawn chama `getActiveResourcesForProject(projectId)` que cruza `cachedResources` (scan on-boot de `~/.config/opencode/...`) com `project_resources WHERE active=1`, e exporta as listas em env vars `OPENCODE_ACTIVE_SKILLS` etc. para a PTY.

#### `tasks` — kanban cards (locais + issues GitHub)

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,                              -- UUID
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  source TEXT NOT NULL DEFAULT 'local'
    CHECK(source IN ('local', 'github')),
  "column" TEXT NOT NULL DEFAULT 'backlog'         -- "column" é palavra reservada
    CHECK("column" IN ('backlog', 'in_progress', 'done')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  github_issue_url TEXT,
  github_labels TEXT,                               -- JSON serializado
  github_issue_number INTEGER,
  session_id TEXT,                                  -- link para PTY (sem FK)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) STRICT;
```

**Sync bidirecional com filesystem**: o `routes/tasks.ts` espelha cada task como `.opencode/tasks/<id>.md` dentro de `project.directory`, com frontmatter YAML. Conflito (editado em ambos) = última edição vence (timestamp), com log de aviso. `POST /api/projects/:id/tasks/sync` reimporta arquivos `.md` que ainda não estão no DB.

### 5.2 PRAGMAs ativos

| PRAGMA         | Valor | Onde           | Por quê                                                                                           |
| -------------- | ----- | -------------- | ------------------------------------------------------------------------------------------------- |
| `journal_mode` | `WAL` | `client.ts:65` | Leituras concorrentes não bloqueiam escritas; melhor throughput. **Não funciona com `:memory:`**. |
| `foreign_keys` | `ON`  | `client.ts:67` | Garante que `ON DELETE CASCADE` de `project_resources` e `tasks` seja respeitado.                 |

### 5.3 O que **NÃO** está no SQLite (e por quê)

| Dado                                          | Onde vive                                                     | Por que não persiste                                                               |
| --------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `SessionMeta` (nome, status, tipo, projectId) | `Map<id, SessionMeta>` em `routes/sessions.ts:48`             | Decisão consciente do Sprint 2 (linha 11-13 do arquivo). Plano para sprint futuro. |
| `SessionState` (pid, buffer, callbacks)       | `Map<id, SessionState>` em `PtyManager`                       | Estado runtime, intrinsecamente volátil.                                           |
| `IPty` (processo real)                        | `Map<id, IPty>` no pty-worker                                 | Um processo vivo não pode ser serializado.                                         |
| Buffer de output (10 KB por sessão)           | `session.buffer: string` no PtyManager                        | Replay on reconnect — só faz sentido enquanto o processo existe.                   |
| `Resource` cache (skills/agents/mcps scan)    | `let cachedResources: Resource[]` em `routes/resources.ts:44` | Re-escaneável sob demanda via `POST /api/resources/scan`.                          |
| `sessionMeta` (o nome)                        | in-memory Map                                                 | Reset on server restart é o comportamento esperado (cite do código).               |
| `connectedClients` (map WS)                   | `Map<sessionId, Set<ClientEntry>>` em `ws/handler.ts:55`      | Conexões TCP ao vivo, não persistíveis.                                            |
| `auth token`                                  | `localStorage` do browser (chave `auth_token`)                | Stateless JWT, o servidor não mantém sessão.                                       |
| `syncInterval` do GitHub polling              | `setInterval` no `routes/github.ts:138`                       | Restart limpa; reinicia no `app.listen`.                                           |
| `statusMonitorInterval`                       | `setInterval` no `PtyManager`                                 | Idem.                                                                              |

### 5.4 Caminho do arquivo

```
DATABASE_PATH=./data/opencode.db       (default; relativo ao CWD do Bun)
DATABASE_PATH=/var/lib/opencode/db     (exemplo de produção)
DATABASE_PATH=:memory:                 (usado em testes)
```

O `initDb()` resolve o parent dir com `mkdirSync({recursive:true})` se faltar. Para `:memory:` é no-op.

---

## 6. Auth (single-user, single-password)

Pipeline:

1. `.env` carrega `AUTH_PASSWORD` (senha mestra) e `JWT_SECRET` (>= 32 chars).
2. `POST /api/auth/login {password}` → se bate, chama `signToken()` (HS256, payload `{sub:'dashboard'}`, expira em `JWT_EXPIRY` = default `7d`).
3. Frontend salva no `localStorage` (`auth_token`).
4. Toda chamada HTTP envia `Authorization: Bearer <jwt>`. `authGuard` (`auth/middleware.ts:10`) valida no `beforeHandle`. Falha → 401 + dispatch do evento custom `auth:logout` no browser → `clearToken()` → tela de login.

> **Limitação conhecida** (PROJECT_CONTEXT §10): WebSocket auth é **deferred** — o upgrade do WS é aceito antes do `authGuard` rodar. Hardening futuro: passar token em query/subprotocol/first message e validar em `open(ws)`.

---

## 7. Outras rotas relevantes (resumo)

| Rota                                                       | Função                                                    | Persistência                                       |
| ---------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------- |
| `POST /api/auth/login`                                     | Troca senha por JWT                                       | stateless                                          |
| `GET/POST/PUT/DELETE /api/projects[/:id]`                  | CRUD de projetos                                          | SQLite `projects`                                  |
| `GET /api/harnesses`                                       | Lista harnesses de `~/.config/opencode/harnesses/`        | filesystem scan                                    |
| `POST/GET/PUT/DELETE /api/projects/:id/sessions`           | **Spawn / list / rename / resize / kill**                 | metadata em memória                                |
| `POST /api/emergency-terminal`                             | Cria (ou retorna) 1 terminal root em `/root`              | metadata em memória                                |
| `GET /api/projects/:id/sessions?status=active`             | Filtra por status                                         | metadata em memória                                |
| `GET /api/projects/stats`                                  | Contadores active/waiting/finished por projeto            | metadata em memória                                |
| `WS /terminal/:sessionId`                                  | Stream xterm + control frames                             | session ao vivo                                    |
| `GET /api/agents`                                          | Painel de agentes (todas as sessões, preview, lastActive) | cruza metadata + buffer + DB                       |
| `GET /api/agents/metrics`                                  | total/active/waiting/finished/emergency                   | idem                                               |
| `GET /api/resources`                                       | Lista skills/agents/mcps escaneados                       | cache em memória                                   |
| `POST /api/resources/scan`                                 | Reescaneia                                                | cache em memória                                   |
| `GET/PUT/DELETE /api/projects/:id/resources[/:resourceId]` | Toggle de ativação por projeto                            | SQLite `project_resources`                         |
| `GET/PUT/POST/DELETE /api/tasks/*`                         | Kanban global (com filtros status/source/projectId)       | SQLite `tasks` + filesystem `.opencode/tasks/*.md` |
| `POST /api/projects/:id/tasks/sync`                        | Reimporta `.md` → DB                                      | filesystem → SQLite                                |
| `POST /api/projects/:id/files` + variantes                 | File browser: list/read/write/create/delete/rename        | filesystem real                                    |
| `GET /api/files/directories?path=`                         | Directory picker (sugere diretórios absolutos)            | filesystem scan                                    |
| `POST /api/projects/:id/github/sync`                       | Manual sync de issues do GitHub                           | fetch → SQLite `tasks`                             |
| `GET/POST/PUT/DELETE /api/github/*`                        | Wrapper REST do sync                                      | idem                                               |

**Background jobs**:

- `startGithubPolling()`: a cada **5 min**, sincroniza issues de todos os projetos com `github_repo` setado.
- `getPtyManager().startStatusMonitor(1000)`: a cada **1 s**, recalcula status detectado (finished/waiting/active) e dispara callbacks de mudança.

---

## 8. Frontend (apps/web) — resumo

- **React 19** + Vite 6 + Tailwind v4 (`@tailwindcss/vite`).
- **Roteamento**: `react-router-dom v7` (API idêntica à v6). Pages: `Login`, `Dashboard`, `Projects`, `ProjectDetail`, `Kanban`, `Emergency`.
- **xterm.js v6** com addons `fit` e `web-links`. Tema dark `#0a0a0f` + accent `#af0`. Mobile-first (375px).
- **Hooks de domínio**:
  - `useSessions()`: agrupa sessões por projeto, refresh a cada 10s + listener de `sessions-changed`.
  - `useTerminalSocket(sessionId)`: gerencia WS com **exponential backoff** (1s → 30s, max 10 tentativas), trata close codes app-defined (4001, 4004) como permanentes, dispara `onExit`/`onStatus` em frames de controle JSON.
  - `AuthContext`: verifica token no mount, ouve `auth:logout`.
- **API client** (`lib/api.ts`): injeta `Authorization: Bearer ...` em toda chamada, trata 401 com `clearToken()` + `auth:logout` event.
- **Vite proxy** em dev: `/api/*` → `http://localhost:3001` (REST), `/terminal` → `http://localhost:3001` com `ws: true` (WebSocket upgrade). Em produção o nginx faz o mesmo (config em `docs/deploy.md`).

---

## 9. Decisões arquiteturais importantes (resumo)

1. **Worker Node isolado** (`apps/pty-worker/`) — workaround obrigatório para `node-pty` × Bun. Sem isso, o servidor panicava.
2. **Sessões in-memory, não SQLite** — meta do Sprint 2 é "MVP funcional", persistência fica para depois. O `PROJECT_CONTEXT.md §4` lista `Session` como core entity, mas o schema ainda não tem tabela para isso.
3. **Buffer circular 10 KB por sessão** — trade-off de memória vs UX de reconexão. Suficiente para reconstituir ~50-200 linhas de TUI típico.
4. **Soft limits** de sessões (warning a >10 totais, >5 por projeto) — não bloqueiam spawn. Decisão de UX para evitar travamento acidental.
5. **WAL no SQLite** — para suportar leituras concorrentes (rotas HTTP) sem bloquear escritas do sync do GitHub.
6. **JWT single-password** — VPS single-user, sem gestão de identidade. Token no localStorage é aceitável dado o contexto (sem XSS surface exposto além do React, e CSP nginx é easy de adicionar).
7. **Polling em vez de WebSocket para dados de listagem** — `useSessions` faz refresh a cada 10s. Mais simples que WS, suficiente para UI de sidebar. O WS é reservado para o stream de terminal (que é a única coisa que realmente precisa de tempo real).
8. **Fallback `opencode` → `bash`** — conveniência para dev machines sem o CLI instalado. Em produção a VPS tem o `opencode` no PATH.
9. **Detecção de status por regex no buffer** — funciona para os prompts comuns (`user@host:path$`). Pode dar falso positivo em prompts customizados exóticos; o detector faz strip de ANSI antes.

---

## 10. Pontos de extensão / onde mexer

| Quero mudar...                            | Arquivo principal                                                                                                                             | Cuidado                                                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Adicionar um campo à tabela `projects`    | `apps/server/src/db/schema.sql` + `routes/projects.ts` (handler + `toProject`)                                                                | Use `IF NOT EXISTS` / `ALTER TABLE` idempotente. Não esqueça de popular `_migrations`.                                     |
| Adicionar uma rota REST                   | Criar arquivo em `apps/server/src/routes/`, exportar como `Elysia` instance, e **registrar com `.use()`** em `apps/server/src/index.ts:48-59` | Esquecer o `.use()` é um bug silencioso — testes isolados não pegam.                                                       |
| Mudar comportamento do PTY worker         | `apps/pty-worker/src/index.ts` (handler) ou `apps/server/src/pty/manager.ts` (lógica de correlação)                                           | Atenção ao protocolo: novas mensagens precisam entrar em `protocol.ts` (ambos os lados).                                   |
| Adicionar um tipo de status detectado     | `apps/server/src/pty/detector.ts` (lógica) + `apps/web/src/hooks/useTerminalSocket.ts` (handler) + UI badges                                  | Status string precisa ser renderizada em `StatusBadge.tsx`.                                                                |
| Persistir SessionMeta no SQLite           | Criar tabela `sessions` em `schema.sql`, modificar `routes/sessions.ts` para usar `db` em vez de Map                                          | Decisão de design — manter em memória permite reconexão rápida e zero overhead; persistir permite histórico entre reboots. |
| Trocar estratégia de reconexão WS         | `apps/web/src/hooks/useTerminalSocket.ts:108` (`computeBackoff`)                                                                              | Testes com `vi.useFakeTimers()` requerem avanço manual de tempo.                                                           |
| Adicionar suporte a múltiplos workers PTY | Hoje o manager fala com UM worker Node. Escalar = sharding por `sessionId` no `BunWorkerTransport`                                            | Cada PTY é isolada no worker, mas o IPC é single-channel — precisa de sharding explícito.                                  |

---

## 11. TL;DR

- **3 processos**: Browser (React), Bun+Elysia (server), Node+node-pty (worker).
- **Comunicação**: REST + JWT, WebSocket (xterm), e stdio JSON-lines (Bun↔Node).
- **Sessões PTY são voláteis**: vivem em memória, sobrevivem a desconexão do browser (10 KB de buffer de replay), mas **morrem em qualquer restart do servidor**.
- **SQLite guarda só o estado de produto**: `projects`, `project_resources`, `tasks`. Tudo sobre o runtime das PTYs é memória RAM.
- **Status é detectado por polling** (1 Hz) com regex de prompt no buffer, exposto via WebSocket e via REST (`/api/projects/:id/sessions/:id/status`).
- **Auth é single-password JWT** — sem gestão de usuários, sem refresh tokens, sem WS auth (deferred).
