# Como o Opencode Gera o TUI e Como Esta Aplicação Lida com Isso

## 1. O que é "TUI" neste contexto?

O termo "TUI" aqui **não** se refere a um framework de UI de terminal (como Ink, Bubble Tea ou React-Blessed). Trata-se da saída ANSI/VT100 produzida pelo CLI do **opencode** — um agente interativo de terminal que usa:
- Sequências de escape ANSI (cores, posicionamento de cursor, clear screen, SGR)
- Caracteres Unicode de box-drawing (╭─╮, ├─┤, └─┘, barras de progresso, etc.)
- Prompts interativos no estilo `user@host:~/path$`

> **Nota importante:** O próprio projeto opencode-dashboard **não gera TUI**. Ele captura a TUI que o CLI opencode produz dentro de um PTY real e a renderiza no navegador via xterm.js. O dashboard é um **visualizador web** de sessões de terminal reais, similar a um tmux via browser, mas com UI própria para gestão de projetos.

---

## 2. Arquitetura Geral: Pipeline Multi-Processo

O sistema é um pipeline de streaming que transporta bytes de um PTY real até o navegador:

```
┌──────────────────────────────────────────────────────────────────┐
│                         VPS (Servidor)                           │
│                                                                  │
│  ┌─────────────┐     ┌──────────────┐     ┌───────────────────┐  │
│  │ opencode CLI │────▶│ pty-worker   │────▶│ PtyManager (Bun)  │  │
│  │ (bash/proc)  │     │ (Node.js 18) │     │ apps/server       │  │
│  │ stdout/in    │     │ node-pty     │     │ WS routing        │  │
│  └─────────────┘     └──────────────┘     └────────┬──────────┘  │
│                                                     │            │
│                                          WebSocket  │ JSON-lines │
│                                          /terminal/ │             │
│                                          :sessionId │             │
└─────────────────────────────────────────────────────┼────────────┘
                                                      │
                                            ┌─────────▼──────────┐
                                            │    Browser          │
                                            │                     │
                                            │  useTerminalSocket  │
                                            │  (React Hook)       │
                                            │         │           │
                                            │  XTermTerminal      │
                                            │  (xterm.js v6)      │
                                            │  ┌───────────────┐  │
                                            │  │ Canvas / DOM  │  │
                                            │  │ renderização  │  │
                                            │  └───────────────┘  │
                                            └─────────────────────┘
```

### Por que 3 processos?

| Processo | Runtime | Motivo |
|---|---|---|
| `opencode CLI` | Qualquer (bash) | É o processo que o usuário quer controlar |
| `pty-worker` | Node.js 18 | `node-pty` v1.1.0 não é compatível com Bun ([issue #18546](https://github.com/oven-sh/bun/issues/18546)) — chama `uv_version_string` do libuv que o Bun ainda não suporta |
| `apps/server` | Bun | O resto do stack (HTTP, WebSocket, SQLite) roda em Bun |

A comunicação entre o servidor Bun e o worker Node.js é feita via **JSON-lines sobre stdio** — cada mensagem é uma linha JSON terminada por `\n`.

---

## 3. Protocolo IPC (Inter-Process Communication)

**Arquivo:** `apps/pty-worker/src/protocol.ts`

### Mensagens do Servidor → Worker (`ClientMessage`)

| Tipo | Descrição | Campos |
|---|---|---|
| `spawn` | Criar um novo PTY | `id`, `cwd`, `command`, `args?`, `cols?`, `rows?`, `env?` |
| `write` | Enviar dados para stdin do PTY | `id`, `data` (string) |
| `resize` | Redimensionar o PTY | `id`, `cols`, `rows` |
| `kill` | Matar o processo | `id` |
| `list` | Listar sessões ativas | (sem campos extras) |
| `shutdown` | Desligar o worker | (sem campos extras) |

### Mensagens do Worker → Servidor (`ServerMessage`)

| Tipo | Descrição | Campos |
|---|---|---|
| `spawned` | PTY criado com sucesso | `id`, `pid` |
| `data` | Saída do PTY (stdout/stderr) | `id`, `chunk` (base64), `encoding: 'base64'` |
| `exit` | Processo terminou | `id`, `code` |
| `killed` | Processo foi morto | `id` |
| `list` | Lista de sessões | `sessions: string[]` |
| `error` | Erro genérico | `id?`, `message` |

### Por que base64?

Os dados do PTY são binários — bytes ANSI, UTF-8 multi-byte, caracteres de controle. Transportar como base64 garante que nenhum byte seja corrompido pela camada JSON/stdin/stdout. O `PtyManager` decodifica de volta para `latin1` (`Buffer.from(chunk, 'base64').toString('binary')`) preservando os valores 0-255.

---

## 4. Fluxo de Dados Passo a Passo

### 4.1 Criação da Sessão (REST API)

```
POST /api/sessions  →  PtyManager.spawnSession()
  → Worker recebe {type:'spawn', id, cwd, command, args}
  → Worker chama pty.spawn() do node-pty
  → Worker responde {type:'spawned', id, pid}
  → PtyManager resolve a promise, sessão fica 'active'
```

**Arquivo:** `apps/server/src/routes/sessions.ts`
**Manager:** `apps/server/src/pty/manager.ts:158-195`

### 4.2 Streaming de Dados (WebSocket Push)

```
opencode CLI → stdout
  ↓ (proc.onData no node-pty)
pty-worker → stdout JSON: {type:'data', id, chunk:'<base64>', encoding:'base64'}
  ↓ (BunWorkerTransport lê via reader loop)
PtyManager.onData() → decodifica base64 → appendToBuffer (circular ~10KB)
  ↓ (dispara dataCallbacks)
WS handler → ws.send(Buffer.from(chunk, 'binary')) para cada cliente conectado
  ↓ (WebSocket binary frame)
useTerminalSocket → handler(data) com Uint8Array
  ↓
XTermTerminal → terminal.write(data)
  ↓ (xterm.js parseia ANSI/VT100)
Canvas/DOM → renderização visual
```

**Worker:** `apps/pty-worker/src/index.ts:139-146` — `proc.onData()` encode base64  
**Transport:** `apps/server/src/pty/transport.bun.ts:145-176` — `readStdoutLoop()`  
**Manager:** `apps/server/src/pty/manager.ts:407-426` — `onData()`  
**WS Handler:** `apps/server/src/ws/handler.ts:138-141` — `dataCb`

### 4.3 Input do Usuário (Browser → PTY)

```
XTermTerminal → terminal.onData(data)
  ↓
useTerminalSocket → ws.send(data) como string
  ↓ (WebSocket text frame)
WS handler → PtyManager.writeToSession(sessionId, data)
  ↓
Worker → proc.write(data) no node-pty
  ↓
opencode CLI → stdin recebe os bytes
```

**Frontend:** `apps/web/src/components/Terminal/XTermTerminal.tsx:357`
**WS Handler:** `apps/server/src/ws/handler.ts:186-208`
**Worker:** `apps/pty-worker/src/index.ts:161-172`

---

## 5. Componentes Críticos da Renderização

### 5.1 XTermTerminal (`apps/web/src/components/Terminal/XTermTerminal.tsx`)

O componente React que cria e gerencia a instância do xterm.js. Pipeline de inicialização:

1. **Font Loading Sync** (linha 259-272) — Espera `JetBrains Mono` (regular + bold) carregar via `document.fonts.load()` antes de chamar `terminal.open()`. Se a fonte não estiver disponível, o xterm.js mede as dimensões dos caracteres com uma fonte fallback, causando colunas desalinhadas e layout TUI quebrado. Timeout de 3 segundos como fallback.

2. **Criação do Terminal** (linha 279-301) — Configuração:
   - `cursorBlink: true`, `cursorStyle: 'block'`
   - `fontFamily: 'JetBrains Mono', ...`
   - `scrollback: 0` (scrollback é gerenciado pelo opencode)
   - `convertEol: false`
   - `allowProposedApi: true`, `macOptionIsMeta: true`
   - **Qualidade visual xterm v6**: `drawBoldTextInBrightColors`, `customGlyphs`, `rescaleOverlappingGlyphs`, `minimumContrastRatio: 4.5`, `allowTransparency: false`

3. **Addons** (linha 304-310):
   - `FitAddon` — auto-resize para preencher o container
   - `Unicode11Addon` — **crítico** para renderizar double-width characters e Unicode block elements do opencode
   - `WebLinksAddon` — URLs clicáveis

4. **Buffer de Dados Pré-Open** (linha 317-333) — Dados WebSocket que chegam antes de `terminal.open()` completar são armazenados em `pendingData[]` e drenados imediatamente após o `open()`, evitando que sequências ANSI vazem como texto cru no DOM.

5. **Staggered Fit** (linha 338-350) — `FitAddon.fit()` é chamado em 0ms, 100ms, 500ms, 1500ms e 3000ms para cobrir o settling do layout do container (page load, tab switch, flex parent recalculation).

6. **ResizeObserver** (linha 360-361) — Dispara `fit()` em todo resize do container. As dimensões (cols × rows) são encaminhadas ao PTY via `POST /api/sessions/:id/resize`.

7. **Status Overlays** — Badges transientes (`Connecting…`, `Reconnecting… (3/10)`) e overlays de erro permanentes (`Session not found`, `Connection lost`) com CTAs contextuais.

### 5.2 useTerminalSocket (`apps/web/src/hooks/useTerminalSocket.ts`)

Hook React que gerencia a conexão WebSocket com reconexão automática:

- **Máquina de estados**: `idle → connecting → connected` / `reconnecting → connected` / `error`
- **Backoff exponencial**: `[1s, 2s, 4s, 8s, 16s, 30s]` — máximo 30s
- **Máximo de tentativas**: 10 (configurável)
- **Códigos de close permanentes**:
  - `4004` — Sessão não encontrada (erro não-recuperável, overlay com CTA "Create new session")
  - `4001` — Sessão já em uso em outra aba (erro não-recuperável)
  - `1000` na primeira tentativa — servidor fechou normalmente, sem reconexão
- **Handlers de mensagem**:
  - Frames binários → PTY output (Uint8Array direto para `terminal.write()`)
  - JSON `{type:'exit', code}` → notifica exit handlers, fecha WS
  - JSON `{type:'status', status}` → notifica status handlers (usado para badges no frontend)
  - Strings não-JSON → tratadas como PTY output raw
- **Cleanup** — `cleanedUpRef` evita transições de estado espúrias durante unmount

### 5.3 PtyManager (`apps/server/src/pty/manager.ts`)

Coordenador central no servidor Bun:

- Mantém `Map<sessionId, SessionState>` com buffer circular (~10KB por sessão)
- API pública: `spawnSession()`, `writeToSession()`, `resizeSession()`, `killSession()`, `listSessions()`
- **Correlação de requests**: spawn/kill são awaitable (promise-based), write/resize são fire-and-forget
- **Buffer replay**: `getSessionBuffer()` retorna o buffer acumulado para reconexão
- **Status Monitor** (1Hz): `setInterval` a cada 1 segundo analisa o buffer de cada sessão com `detectStatus()` e notifica mudanças de status (active → waiting → finished)
- **Failure handling**: timeout de 5s por request, worker exit rejeita todas as promises pendentes e marca sessões como exited

### 5.4 WebSocket Handler (`apps/server/src/ws/handler.ts`)

Ponte entre WebSocket e PtyManager:

- **`handleOpen`**: Valida a sessão, envia buffer replay para o cliente reconectar com estado visível, registra callbacks de data/exit/status
- **`handleMessage`**: Decodifica frames binários/texto e encaminha para `writeToSession()`
- **`handleClose`**: Remove apenas os callbacks do cliente específico (previne memory leak), mas mantém a sessão PTY viva para futuras reconexões
- **Multi-tab**: Múltiplos clientes WebSocket podem se conectar à mesma sessão; output é broadcast para todos

### 5.5 Status Detector (`apps/server/src/pty/detector.ts`)

Analisa o buffer de saída para classificar o estado da sessão:

| Estado | Significado | Critério |
|---|---|---|
| `active` | Agente está trabalhando | Buffer não termina com prompt, ou sessão está `pending` |
| `waiting` | Agente está ocioso, esperando input | Última linha do buffer casa com `OPENCODE_PROMPT_REGEX` |
| `finished` | Processo terminou | Sessão está `exited` ou `killed` |

**Regex de prompt** (`detector.ts:47`):
```regex
/[\w.+-]+@[\w.-]+:[\w/~.-]*[$#>]\s*$/
```
Detecta padrões como `user@host:~/path$`, `root@server:/#`, `dev@box:project>` no final do buffer.

**Pré-processamento**: Stripa sequências de escape ANSI (`\x1b\[[0-9;]*[a-zA-Z]`) antes de aplicar a regex, para que códigos de cor/posicionamento não interfiram na detecção.

---

## 6. Estratégia de Reconexão e Resiliência

### 6.1 Buffer Replay

Quando um cliente reconecta, o servidor envia o buffer acumulado (~10KB das saídas mais recentes) via WebSocket. O xterm.js pinta todo o estado visível de uma vez, reconstruindo exatamente o que o usuário veria no terminal. O buffer é circular — quando excede `BUFFER_MAX` (10KB), as linhas mais antigas são descartadas.

**Arquivos relevantes:**
- `manager.ts:508-513` — `appendToBuffer()` com slice circular
- `handler.ts:128-131` — buffer replay no connect
- `manager.ts:286-293` — `getSessionBuffer()`

### 6.2 Backoff de Reconexão (Frontend)

O hook `useTerminalSocket` implementa backoff exponencial:

| Tentativa | Delay | Acumulado |
|---|---|---|
| 1 | 1s | 1s |
| 2 | 2s | 3s |
| 3 | 4s | 7s |
| 4 | 8s | 15s |
| 5 | 16s | 31s |
| 6-10 | 30s | ~3min |

Após 10 tentativas falhas (~3 minutos), transiciona para estado `error` com mensagem "Could not reconnect after multiple attempts. The session is still active on the server. Please reload the page."

### 6.3 Resiliência do Servidor

- **Sessões PTY são long-lived** — não morrem quando o WebSocket fecha. O usuário pode desconectar/reconectar livremente.
- **Worker crash** — `PtyManager.handleWorkerExit()` (linha 475-494) marca todas as sessões como exited com código sentinela -1, notifica todos os subscribers, e rejeita todas as promises pendentes.
- **Timeout de request** — 5 segundos por operação spawn/kill/list. Requests que excedem o timeout são rejeitados e a sessão é limpa.
- **Kill é idempotente** — o worker responde `{type:'killed'}` mesmo se a sessão já não existir mais.

---

## 7. Mapeamento Completo de Arquivos

### 7.1 Frontend — Renderização do Terminal (xterm.js)

| Caminho do Arquivo | Descrição |
|---|---|
| `apps/web/src/components/Terminal/XTermTerminal.tsx` | **Componente central do terminal.** Cria instância xterm.js v6 com font-sync, FitAddon, WebLinksAddon, Unicode11Addon. Conecta I/O do WebSocket, ResizeObserver, staggered fits, tema Dracula, overlays de erro e badge de status de conexão. Contém os tipos `ConnectionStatus`, `XTermTerminalProps` e `XTermTerminalHandle`. |
| `apps/web/src/components/Terminal/index.ts` | **Barrel export** para `XTermTerminal` e seus tipos. |
| `apps/web/src/hooks/useTerminalSocket.ts` | **Hook do cliente WebSocket.** Gerencia ciclo de vida da conexão WS: open, reconexão com backoff exponencial (1s→30s), classificação de close codes (4001=em uso, 4004=não encontrado), dispatch de frames binários/texto, e roteamento de mensagens de controle (`{type:'exit'}`, `{type:'status'}`). Contém os tipos `ConnectionStatus`, `ConnectionError`, `DataHandler`, `UseTerminalSocketOptions`, `UseTerminalSocketReturn`. |
| `apps/web/src/hooks/useSessions.ts` | **Hook de lista de sessões.** Busca sessões por projeto, polling a cada 10s, expõe ações de renomear/fechar/criar. Alimenta a sidebar. |
| `apps/web/src/components/EmergencyTerminal/EmergencyTerminal.tsx` | **Botão flutuante + modal do terminal de emergência.** Verifica sessão de emergência existente via `/api/agents` e cria via `POST /api/emergency-terminal`. Contém os tipos `EmergencySession` e `EmergencyTerminalProps`. |
| `apps/web/src/components/EmergencyTerminal/index.ts` | Barrel export para EmergencyTerminal. |
| `apps/web/src/components/ConnectionStatus/ConnectionStatus.tsx` | **Indicador de conexão.** Ponto verde/amarelo/vermelho na barra superior, monitorando `navigator.onLine`. |
| `apps/web/src/components/StatusBadge/StatusBadge.tsx` | Badge de status para estados de sessão (active/waiting/finished), usado na lista de sessões da sidebar. |
| `apps/web/src/pages/ProjectDetail.tsx` | **Página de detalhes do projeto.** Contém a aba do terminal, CTA `EmptyTerminalState`, fluxo de criar/fechar sessão, renderiza `XTermTerminal` para sessões ativas. Debounce de resize. |
| `apps/web/src/pages/Emergency.tsx` | **Página do terminal de emergência.** Carrega a sessão PTY de emergência e renderiza `XTermTerminal` dentro de um container com borda vermelha/laranja. |

### 7.2 Frontend — Estilos CSS do Terminal

| Caminho do Arquivo | Descrição |
|---|---|
| `apps/web/src/index.css` | **Estilos globais.** Importa JetBrains Mono (regular + bold para terminal), e contém o **override do viewport do xterm.js**: `.xterm .xterm-viewport { overflow-y: hidden !important; }` para evitar conflito de scroll com @opentui. |
| `apps/web/src/components/StatusBadge/status.css` | Estilização do badge de status. |

### 7.3 Frontend — Configuração do Vite (Proxy WebSocket)

| Caminho do Arquivo | Descrição |
|---|---|
| `apps/web/vite.config.ts` | **Configuração dev do Vite.** Proxy `/terminal` → `http://localhost:3001` com **`ws: true`** (upgrade WebSocket) e `changeOrigin: true`. Também faz proxy de `/api` para o mesmo target. |

### 7.4 Frontend — Testes do Terminal

| Caminho do Arquivo | Descrição |
|---|---|
| `apps/web/src/components/ConnectionStatus/ConnectionStatus.test.tsx` | Testes do componente ConnectionStatus. |
| `apps/web/src/pages/ProjectDetail.test.tsx` | Testes da página ProjectDetail (CTA do terminal, criação de sessão, troca de abas). |

### 7.5 Backend — WebSocket Handler

| Caminho do Arquivo | Descrição |
|---|---|
| `apps/server/src/ws/handler.ts` | **Transporte WebSocket.** Define a rota WS `/terminal/:sessionId`, buffer replay no connect, relay bidirecional do PTY, suporte multi-tab (múltiplos clientes WS por sessão), close code 4004, frames JSON de exit/status, e limpeza de callbacks no disconnect. Exporta `handleOpen`, `handleMessage`, `handleClose` para teste. |
| `apps/server/src/ws/handler.test.ts` | Testes do handler WS (abertura/mensagem/fechamento com objetos WS mock, multi-cliente, buffer replay, relay de exit). |

### 7.6 Backend — PTY Manager (Ciclo de Vida da Sessão)

| Caminho do Arquivo | Descrição |
|---|---|
| `apps/server/src/pty/manager.ts` | **Classe PtyManager.** Coordenador central: spawn/write/resize/kill/list de sessões, buffer circular de saída (~10KB por sessão) para replay na reconexão, registro de callbacks data/exit/status, monitor de status periódico (intervalo de 1s), tratamento de crash do worker (marca todas as sessões como exited com código -1). Singleton padrão via `getPtyManager()`. |
| `apps/server/src/pty/manager.test.ts` | Testes do PtyManager (spawn, kill, resize, write, buffer circular, recuperação de crash do worker, timeouts, prevenção de duplicatas). |
| `apps/server/src/pty/detector.ts` | **Detector de status.** Regex `OPENCODE_PROMPT_REGEX` (`/[\w.+-]+@[\w.-]+:[\w/~.-]*[$#>]\s*$/`) detecta prompt do opencode CLI no buffer após stripar sequências ANSI. Retorna `'active'` / `'waiting'` / `'finished'`. Também fornece timestamp `getLastActiveAt`. |
| `apps/server/src/pty/detector.test.ts` | Testes do detector de status. |

### 7.7 Backend — Transporte PTY (IPC para o Worker)

| Caminho do Arquivo | Descrição |
|---|---|
| `apps/server/src/pty/transport.ts` | **Interface de transporte.** Define o contrato `WorkerTransport`: `start()`, `send(ClientMessage)`, `onMessage(cb)`, `onExit(cb)`, `shutdown()`. |
| `apps/server/src/pty/transport.bun.ts` | **Transporte de produção.** Spawna o pty-worker Node.js via `Bun.spawn` usando caminho explícito do Node 18 LTS para compatibilidade ABI. Lê stdout do worker como JSON-lines, faz pipe de stderr, trata shutdown com 2s de grace + force-kill. |
| `apps/server/src/pty/transport.memory.ts` | **Transporte de teste.** Grava mensagens enviadas, expõe `simulateMessage()` e `simulateExit()` para controle determinístico. |

### 7.8 Backend — REST API de Sessões

| Caminho do Arquivo | Descrição |
|---|---|
| `apps/server/src/routes/sessions.ts` | **API REST de sessões.** `POST /api/projects/:id/sessions` (spawn `opencode; exec bash` no PTY), `GET /api/projects/:id/sessions` (lista com detecção de status), `PUT /api/sessions/:id` (renomear), `GET /api/sessions/:id/status`, `POST /api/sessions/:id/resize`, `POST /api/emergency-terminal` (bash root), `DELETE /api/sessions/:id` (matar). Passa variáveis de ambiente `OPENCODE_ACTIVE_SKILLS/AGENTS/MCPS`. |
| `apps/server/src/routes/sessions.test.ts` | Testes das rotas de sessão (spawn, list, rename, resize, kill, emergency). |

### 7.9 Backend — Entry Point do Servidor

| Caminho do Arquivo | Descrição |
|---|---|
| `apps/server/src/index.ts` | **Entry point do servidor.** Registra `wsRoutes`, inicia `getPtyManager().startStatusMonitor(1000)` no listen. |

### 7.10 Worker — PTY Worker (Subprocesso Node.js)

| Caminho do Arquivo | Descrição |
|---|---|
| `apps/pty-worker/src/index.ts` | **Entry point do PTY worker.** Processo Node.js isolado usando `node-pty`. Lê JSON-lines do stdin, despacha para handlers (`handleSpawn`, `handleWrite`, `handleResize`, `handleKill`, `handleList`, `handleShutdown`). Spawna PTYs com `name:'xterm-color'`, codifica saída como base64, envia `{type:'data'/'exit'/'spawned'}` no stdout. |
| `apps/pty-worker/src/protocol.ts` | **Tipos do protocolo IPC.** Define todos os tipos `ClientMessage` (spawn/write/resize/kill/list/shutdown) e `ServerMessage` (spawned/data/exit/killed/list/error), mais validador `isClientMessage`. Compartilhado entre servidor e worker. |
| `apps/pty-worker/src/index.test.ts` | Testes dos handlers do worker (spawn com FakePty, write, resize, kill, list, shutdown, loop IPC end-to-end). |

### 7.11 Worker — Configuração

| Caminho do Arquivo | Descrição |
|---|---|
| `apps/pty-worker/package.json` | Pacote do worker: `node-pty ^1.1.0`, `tsx`, `vitest`, `@types/node ^18`. |
| `apps/pty-worker/vitest.config.ts` | Config Vitest: ambiente Node, globals habilitados. |
| `apps/pty-worker/tsconfig.json` | Config TypeScript do worker. |

### 7.12 Backend — Script de Validação

| Caminho do Arquivo | Descrição |
|---|---|
| `apps/server/scripts/validate-pty.ts` | **Verificação de compatibilidade do node-pty.** Spawna um PTY bash no Bun, envia `echo "hello from pty"`, e verifica se a saída aparece. Reporta versão do Bun, node-pty, plataforma. Histórico do Sprint 1. |

### 7.13 Configuração — Build & Test

| Caminho do Arquivo | Descrição |
|---|---|
| `vitest.config.ts` | **Vitest workspace raiz.** Projetos: `apps/server`, `apps/web`, `apps/pty-worker`. |
| `apps/server/tsconfig.json` | **Tsconfig do servidor.** Inclui `../../pty-worker/src/protocol.ts` e rootDirs com pty-worker para tipos compartilhados do protocolo. |
| `package.json` | **Package.json raiz.** Script `"dev:pty-worker": "bun run --filter @opencode/pty-worker dev"` e workspace `apps/pty-worker`. |
| `bun.lock` | Lockfile com `@xterm/xterm@6.0.0`, `@xterm/addon-fit`, `@xterm/addon-unicode11`, `@xterm/addon-web-links`. |

### 7.14 Documentação

| Caminho do Arquivo | Descrição |
|---|---|
| `docs/TUI_RENDERING.md` | **Este documento.** Arquitetura de renderização do terminal, pipeline completo, mapeamento de arquivos. |
| `docs/ARCHITECTURE.md` | **Arquitetura do sistema.** Seções sobre transporte WebSocket, ciclo de vida do PTY, spawning de processos, detecção de status, suporte multi-tab, e passagem de env para o opencode. |
| `PROJECT_CONTEXT.md` | **Contexto do projeto & lições aprendidas.** Documenta padrões relacionados ao terminal: font-sync antes de `terminal.open()`, opções nativas do xterm.js v6, `scrollback:0`, `[contain:strict]` CSS, padrão WorkerTransport, dimensionamento do bufferMax, reconexão WebSocket. |

### 7.15 Resumo Visual do Pipeline por Camada

```
┌────────────────────────────────────────────────────────────────────┐
│ CAMADA 1: Browser (xterm.js + JetBrains Mono)                     │
│ apps/web/src/                                                      │
│   components/Terminal/XTermTerminal.tsx                            │
│   components/Terminal/index.ts                                     │
│   hooks/useTerminalSocket.ts                                       │
│   hooks/useSessions.ts                                             │
│   components/EmergencyTerminal/EmergencyTerminal.tsx               │
│   components/ConnectionStatus/ConnectionStatus.tsx                 │
│   components/StatusBadge/StatusBadge.tsx                           │
│   pages/ProjectDetail.tsx                                          │
│   pages/Emergency.tsx                                              │
│   index.css (viewport override)                                    │
├────────────────────────────────────────────────────────────────────┤
│ CAMADA 2: Proxy (Vite Dev)                                        │
│ apps/web/vite.config.ts  →  ws:true, /terminal → :3001            │
├────────────────────────────────────────────────────────────────────┤
│ CAMADA 3: WebSocket Bridge (Elysia)                               │
│ apps/server/src/                                                   │
│   ws/handler.ts  (/terminal/:sessionId)                            │
│   index.ts  (registra wsRoutes, inicia status monitor)             │
├────────────────────────────────────────────────────────────────────┤
│ CAMADA 4: PTY Manager (Bun)                                       │
│ apps/server/src/pty/                                               │
│   manager.ts  (spawn/write/resize/kill, buffer circular)           │
│   detector.ts  (regex de prompt, strip ansi)                       │
│   transport.ts  (interface WorkerTransport)                        │
│   transport.bun.ts  (Bun.spawn → Node.js worker)                   │
│   transport.memory.ts  (mock para teste)                           │
├────────────────────────────────────────────────────────────────────┤
│ CAMADA 5: REST API (Elysia)                                       │
│ apps/server/src/routes/                                            │
│   sessions.ts  (CRUD de sessões, resize, emergency, env vars)     │
├────────────────────────────────────────────────────────────────────┤
│ CAMADA 6: IPC (JSON-lines via stdio)                              │
│ apps/pty-worker/src/                                               │
│   protocol.ts  (ClientMessage ↔ ServerMessage)                     │
├────────────────────────────────────────────────────────────────────┤
│ CAMADA 7: PTY Worker (Node.js 18, node-pty)                       │
│ apps/pty-worker/src/                                               │
│   index.ts  (spawn/write/resize/kill/list/shutdown)               │
├────────────────────────────────────────────────────────────────────┤
│ CAMADA 8: Linux PTY (kernel)                                      │
│ opencode CLI → bash → stdout/sterr, stdin                         │
└────────────────────────────────────────────────────────────────────┘
```

---

## 8. Diagrama de Sequência: Sessão Completa

```
Browser                Server (Bun)           Worker (Node.js)       PTY (opencode)
  │                        │                       │                     │
  │  POST /api/sessions   │                       │                     │
  │──────────────────────▶│                       │                     │
  │                        │  {type:'spawn',...}   │                     │
  │                        │──────────────────────▶│                     │
  │                        │                       │  pty.spawn('bash')  │
  │                        │                       │────────────────────▶│
  │                        │                       │◀─ pid=12345 ────────│
  │                        │  {type:'spawned',...} │                     │
  │                        │◀──────────────────────│                     │
  │  { sessionId, pid }   │                       │                     │
  │◀──────────────────────│                       │                     │
  │                        │                       │                     │
  │  WS /terminal/:id     │                       │                     │
  │──────────────────────▶│                       │                     │
  │  ◀─ buffer replay ───│                       │                     │
  │                        │                       │                     │
  │                        │                       │  stdout "opencode>" │
  │                        │                       │◀────────────────────│
  │                        │  {type:'data',chunk}  │                     │
  │                        │◀──────────────────────│                     │
  │  ◀─ binary frame ────│                       │                     │
  │  terminal.write()     │                       │                     │
  │                        │                       │                     │
  │  (usuário digita)     │                       │                     │
  │  ws.send("help\n")    │                       │                     │
  │──────────────────────▶│                       │                     │
  │                        │  {type:'write',data}  │                     │
  │                        │──────────────────────▶│                     │
  │                        │                       │  proc.write("help") │
  │                        │                       │────────────────────▶│
  │                        │                       │                     │
  │  (a cada 1s)          │                       │                     │
  │                        │  detectStatus()       │                     │
  │                        │  → status: 'waiting'  │                     │
  │  ◀─ {type:'status'} ─│                       │                     │
  │  badge "Waiting"      │                       │                     │
```

---

## 9. Decisões Técnicas Notáveis

1. **node-pty em worker isolado (Node.js 18)**: O Bun não suporta `uv_version_string` do libuv, necessário para a inicialização do addon nativo do node-pty. Em vez de abandonar o Bun, o projeto isola a dependência problemática em um processo Node.js separado, comunicando via stdio JSON-lines.

2. **Encoding base64 no IPC**: Dados binários do PTY (ANSI escapes, UTF-8 multi-byte) são codificados em base64 para evitar corrupção na camada JSON → stdio → stdout. O PtyManager decodifica de volta para `binary` (latin1) para preservar bytes 0-255.

3. **Buffer circular com replay**: O buffer de ~10KB por sessão permite que o xterm.js reconstrua o estado visual na reconexão. O servidor nunca descarta o buffer enquanto a sessão existe (mesmo após o processo PTY terminar).

4. **Font sync antes de `terminal.open()`**: xterm.js mede dimensões de caracteres no momento do `open()`. Se a fonte JetBrains Mono ainda não carregou, o xterm usa uma fallback com métricas diferentes, quebrando o layout de colunas/linhas e causando desalinhamento visual da TUI do opencode.

5. **Scrollback desabilitado no xterm**: `scrollback: 0` — o scrollback é delegado ao próprio opencode (que tem seu próprio buffer de scrollback via `@opentui`), evitando duplicação e dessincronização.

6. **Staggered Fit**: Chamar `FitAddon.fit()` apenas uma vez após `open()` não é suficiente — o container pode estar em transição de layout (flex parent, tab switch, animações CSS). As chamadas em 100ms, 500ms, 1500ms e 3000ms cobrem esses cenários.

7. **ResizeObserver + debounce**: O redimensionamento do terminal é observado e propagado ao PTY. No lado do frontend (`ProjectDetail.tsx`), o resize é debounced para não sobrecarregar o servidor com requests de resize durante arrasto de janela.

8. **PTY sobrevive ao desconectar**: Diferente de uma abordagem "por sessão de browser", a sessão PTY é independente das conexões WebSocket. O usuário pode fechar o navegador e reabrir — o processo opencode continua rodando.

9. **Status detection via regex no buffer**: Em vez de depender de sinais do processo (que seriam complexos e frágeis), o sistema analisa o buffer de saída em busca de padrões de prompt. Isso funciona porque o opencode CLI sempre exibe um prompt quando está ocioso.
