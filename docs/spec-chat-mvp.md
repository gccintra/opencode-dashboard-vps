# Spec: Project Chat MVP

**Status:** Proposta  
**Data:** 2026-06-18

---

## Objetivo

Interface de chat dentro de um projeto onde o usuário conversa com Claude e vê tool calls/thinking em tempo real. Claude roda headless, server faz relay via SSE, frontend renderiza com UI dedicada (não terminal).

---

## Arquitetura

```
Browser
  POST /api/projects/:id/chat  { message }
        │
        ▼
apps/server (Bun + Elysia)
  1. Verifica projeto existe no DB
  2. Bun.spawn(['claude', '-p', message,
        '--output-format', 'stream-json',
        '--verbose',
        '--permission-mode', 'bypassPermissions',
        '--resume', <claudeSessionId>?   ← multi-turn
     ], { cwd: project.directory, stdout: 'pipe' })
  3. Lê stdout linha a linha (NDJSON)
  4. Cada linha → SSE event: "data: <line>\n\n"
  5. Evento 'result' → salva mensagens no DB, guarda novo session_id
        │
        ▼ ReadableStream (text/event-stream)
        │
Browser
  fetch() body reader → parse SSE → atualiza UI incrementalmente
```

**Multi-turn:** `Map<projectId, claudeSessionId>` em memória no servidor. Passa `--resume` em cada request subsequente. Reseta no restart (aceitável para MVP — histórico persiste no DB).

---

## Backend

### Novo arquivo: `apps/server/src/routes/chat.ts`

**`GET /api/projects/:id/chat/history`**
- Busca `chat_messages` do DB filtrando por `project_id`, ordenado por `created_at`
- Retorna array de `{ id, role, content, created_at }`

**`POST /api/projects/:id/chat`**
- Body: `{ message: string }`
- Fluxo:
  1. Valida projeto existe
  2. Salva mensagem do usuário no DB
  3. Pega `claudeSessionId` do Map (se existe)
  4. `Bun.spawn(...)` com flags headless
  5. Retorna `new Response(readableStream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } })`
  6. Background: lê stdout → relay SSE → ao final, salva resposta do assistente + atualiza Map

### Modificar: `apps/server/src/db/schema.sql`

```sql
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  role TEXT NOT NULL,      -- 'user' | 'assistant'
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS idx_chat_messages_project
  ON chat_messages(project_id, created_at);
```

### Modificar: `apps/server/src/index.ts`
Importar `chatRoutes` e registrar com `.use(chatRoutes)`.

---

## Frontend

### Novo: `apps/web/src/pages/Chat/ChatPanel.tsx`
Componente principal. Responsável por:
- Load do histórico via `apiFetch` no mount
- `sendMessage(text)`: POST via `fetch` nativo (não `apiFetch` — precisa ler body como stream)
- Estado: `messages[]`, `streamingContent: string`, `pendingToolCalls[]`, `isStreaming: boolean`
- Auto-scroll ao final em novo conteúdo

### Novo: `apps/web/src/pages/Chat/ChatMessage.tsx`
Props: `role: 'user' | 'assistant'`, `content: string`, `toolCalls?: ToolCall[]`

| Role | Estilo |
|------|--------|
| `user` | Alinhado à direita, `bg-[#b3e502]/10 border border-[#b3e502]/20` |
| `assistant` | Alinhado à esquerda, `bg-[#111118] border border-white/[0.07]`, cursor piscando durante stream |

### Novo: `apps/web/src/pages/Chat/ToolCallCard.tsx`
Props: `name: string`, `input: unknown`, `result?: string`, `status: 'pending' | 'done' | 'error'`
- Colapsado por padrão: mostra `⚙ tool_name` + status dot
- Expandido: JSON do input + texto do result
- Estilo: `bg-white/[0.03] border border-white/[0.05] rounded-[8px]`

### Modificar: `apps/web/src/pages/ProjectDetail.tsx`
- Linha ~60: adicionar `'chat'` ao tipo `PageTab`
- TabBar: adicionar entrada `{ id: 'chat', label: 'Chat' }`
- Content area: adicionar bloco `{activeTab === 'chat' && <ChatPanel projectId={projectId} />}`

---

## Parsing dos eventos NDJSON (frontend)

Cada linha do SSE `data:` é um objeto JSON:

| Tipo | Ação no frontend |
|------|-----------------|
| `{"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}` | Append em `streamingContent` |
| `{"type":"tool_use","name":"bash","input":{...}}` | Push em `pendingToolCalls` |
| `{"type":"tool_result","tool_use_id":"...","content":"..."}` | Match + update no tool call |
| `{"type":"result","subtype":"success","result":"...","session_id":"..."}` | Finaliza mensagem, limpa estado de streaming |
| `{"type":"result","subtype":"error_during_execution"}` | Mostra erro inline |

---

## Fases de Entrega

| Fase | Escopo |
|------|--------|
| 1 | Schema SQL + rota backend (GET history + POST stream) |
| 2 | ChatPanel + ChatMessage básico (sem tool cards) |
| 3 | ToolCallCard + integração na tab do ProjectDetail |
| 4 | Polish: Aurora Glass, mobile, scroll behavior |

---

## Verificação

1. `bun run dev` — 3 processos iniciam sem erro
2. Abrir projeto → aba "Chat" aparece
3. Digitar mensagem → resposta stream em tempo real visível
4. Tool calls (bash, read_file) aparecem como cards colapsáveis
5. Segunda mensagem mantém contexto (multi-turn via `--resume`)
6. Reload da página → histórico carrega do DB
