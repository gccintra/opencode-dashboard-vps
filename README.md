# OpenCode Dashboard

Interface web mobile-first para **múltiplas sessões do opencode CLI rodando em paralelo** na sua VPS. Terminal real via PTY (node-pty + xterm.js), file browser com editor de código, Kanban com sync de GitHub Issues, painel de agentes, e mais.

> Rodando em: `http://localhost:5173` (dev) — Login com senha única configurada via `.env`

---

## Stack

| Layer | Tecnologia |
|-------|-----------|
| Frontend | React 19 + Vite 6 + Tailwind CSS v4 + xterm.js |
| Backend | Bun + Elysia |
| PTY Real | node-pty (em worker Node.js isolado) |
| WebSocket | Elysia WS nativo |
| Database | bun:sqlite (SQLite) |
| Auth | JWT (jose) — senha única |
| Proxy/SSL | nginx + Let's Encrypt |
| Process Manager | PM2 |
| Monorepo | Bun workspaces |

---

## Pré-requisitos

| Ferramenta | Versão |
|-----------|--------|
| **Bun** | >= 1.3.x |
| **Node.js** | **>= 18.0.0 e <= 18.x** (para o pty-worker — node-pty 1.1.0 requer ABI do Node 18) |

Instale o Bun:
```bash
curl -fsSL https://bun.sh/install | bash
```

---

## Setup

```bash
# 1. Clone
git clone <repo-url> opencode-dashboard
cd opencode-dashboard

# 2. Instalar dependências (raiz + todos os workspaces)
bun install

# 3. Configurar variáveis de ambiente
cp .env.example .env
```

Edite `.env` com seus valores reais:

```env
SERVER_PORT=3001
DATABASE_PATH=./data/opencode.db
HARNESSES_PATH=/root/.config/opencode/harnesses

# Auth (obrigatório — server não sobe sem isso)
AUTH_PASSWORD=suasenhaaqui
JWT_SECRET=um-segredo-aleatorio-de-pelo-menos-32-caracteres
JWT_EXPIRY=7d
```

---

## Desenvolvimento

Subir **tudo** (frontend + backend em paralelo):
```bash
bun run dev
```

Subir **apenas um workspace**:
```bash
bun run dev:web          # Frontend (Vite) → http://localhost:5173
bun run dev:server       # Backend (Elysia) → http://localhost:3001
bun run dev:pty-worker   # Worker PTY (Node.js isolado)
```

O Vite faz proxy de `/api` e `/terminal` para o backend (`http://localhost:3001`). Acesse `http://localhost:5173` e faça login.

---

## Production Build

```bash
# Build frontend + backend
bun run build

# Iniciar em produção
NODE_ENV=production bun run apps/server/dist/index.js
```

---

## Deploy

### PM2 (recomendado)

Produção + dev em paralelo com bancos isolados:

```bash
# Build de produção
bun run build

# Iniciar ambos os ambientes
pm2 start ecosystem.config.cjs
pm2 save
```

| Ambiente | Porta | Banco | Hot-reload |
|----------|-------|-------|------------|
| Produção | 3001 | `data/opencode.db` | não |
| Dev | 3002 | `data/opencode_dev.db` | sim (`--watch`) |

```bash
pm2 status                          # status de ambos
pm2 logs opencode-dashboard         # logs produção
pm2 logs opencode-dashboard-dev     # logs dev
pm2 restart opencode-dashboard      # reiniciar produção
```

---

## Scripts Disponíveis

| Comando | Descrição |
|---------|-----------|
| `bun run dev` | Sobe frontend + backend em paralelo |
| `bun run dev:web` | Só o Vite (React) |
| `bun run dev:server` | Só o Elysia |
| `bun run dev:pty-worker` | Worker PTY isolado |
| `bun run build` | Build de produção (web + server) |
| `bun run start` | Inicia produção (`NODE_ENV=production`) |
| `bun test` | Vitest (server + web) |
| `cd apps/pty-worker && bunx vitest run` | Testes do pty-worker |
| `bun run lint` | ESLint em todos os workspaces |
| `bun run typecheck` | `tsc --noEmit` em todos os workspaces |
| `bun run format` | Prettier em todos os arquivos |
| `bun run format:check` | Verifica formatação |

---

## Estrutura do Projeto

```
opencode-dashboard/
├── apps/
│   ├── server/            # Bun + Elysia (API + WebSocket + DB)
│   │   └── src/
│   │       ├── index.ts           # Entry point
│   │       ├── auth/              # JWT + senha única
│   │       ├── db/                # bun:sqlite + schema.sql
│   │       ├── pty/               # Gerenciador de sessões PTY
│   │       ├── routes/            # Rotas REST (projects, sessions, files, etc)
│   │       └── ws/                # WebSocket handler
│   ├── web/               # React 19 + Vite + Tailwind
│   │   └── src/
│   │       ├── components/       # Terminal, Sidebar, FileTree, CodeEditor, Kanban...
│   │       ├── hooks/            # useTerminal, useSessions...
│   │       └── pages/            # Login, Dashboard
│   └── pty-worker/        # Worker Node.js isolado com node-pty
│       └── src/
│           └── index.ts          # IPC loop + handlers PTY
├── deploy/
│   ├── DEPLOY.md                  # Guia completo de deploy
│   └── nginx/                     # Configuração do nginx
├── data/                          # SQLite databases
│   ├── opencode.db                 # Produção
│   └── opencode_dev.db             # Desenvolvimento
├── logs/                          # Logs do PM2 (prod + dev)
├── ecosystem.config.cjs           # Config do PM2 (prod + dev)
├── package.json                   # Monorepo root (Bun workspaces)
├── tsconfig.base.json
└── vitest.config.ts
```

---

## Arquitetura

```
                     Browser (qualquer dispositivo)
                           │
                     ──────┴──────
                    │             │
                HTTPS:443     WS:wss://
                    │             │
              ┌─────┴─────────────┴─────┐
              │         nginx           │
              │  (SSL + proxy reverso)   │
              └─────┬─────────────┬─────┘
                    │             │
              HTTP:3001       WS:3001/terminal/
                    │             │
              ┌─────┴─────────────┴─────┐
              │     Elysia (Bun)        │
              │  API REST + WS handler  │
              └─────┬─────────────┬─────┘
                    │             │
              ┌─────┘             │
              ▼                   ▼
        ┌──────────┐     ┌───────────────┐
        │ SQLite   │     │  pty-worker   │
        │ bun:sqlite│     │ (Node.js)     │
        └──────────┘     │  ──── node-pty│
                         └──────┬────────┘
                                │
                           ┌────▼────┐
                           │ opencode│
                           │  CLI    │
                           └─────────┘
```

### Por que um worker Node.js separado?

O addon nativo `node-pty` chama `uv_version_string` (libuv), que **não é implementado pelo Bun**. Tentar importar `node-pty` no Bun causa `panic(main thread): unsupported uv function`. A solução é rodar o node-pty em um processo **Node.js 18 isolado** e comunicar via IPC (JSON lines por stdio).

**⚠️ A VPS de produção DEVE usar Node 18 LTS** para o pty-worker. O prebuild do `node-pty@1.1.0` foi gerado contra `libnode.so.109`. Node 22+ segfaulta.

---

## Variáveis de Ambiente

| Variável | Obrigatório | Padrão | Descrição |
|----------|------------|--------|-----------|
| `SERVER_PORT` | Não | `3001` | Porta do backend Elysia |
| `DATABASE_PATH` | Não | `./data/opencode.db` | Caminho do SQLite |
| `HARNESSES_PATH` | Não | `~/.config/opencode/harnesses` | Diretório de harnesses |
| `AUTH_PASSWORD` | **Sim** | — | Senha única para login |
| `JWT_SECRET` | **Sim** | — | Chave para assinar tokens (mín. 32 chars) |
| `JWT_EXPIRY` | Não | `7d` | Expiração do token JWT |

---

## Estrutura do Banco de Dados (SQLite)

- `projects` — Projetos registrados com diretório, repositório GitHub opcional, harness
- `project_resources` — Recursos (skills/agents) ativos por projeto
- `tasks` — Kanban cards (origem: local ou GitHub issue)
- `_migrations` — Controle de migrations aplicadas

Schema em `apps/server/src/db/schema.sql`, aplicado automaticamente no boot.

---

## Notas Importantes

- **node-pty + Bun**: O worker PTY é um processo Node.js separado. O servidor Bun se comunica com ele via IPC (stdio). **Nunca importe `node-pty` diretamente no servidor Bun.**
- **Node 18 obrigatório** no pty-worker em produção (`node --version` deve ser `v18.x.x`).
- O banco SQLite é file-based (`./data/opencode.db`), backup periódico recomendado.
- WAL mode ativado por padrão — gera arquivos `-shm` e `-wal` ao lado do `.db`.
