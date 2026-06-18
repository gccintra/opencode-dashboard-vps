import { Elysia } from 'elysia';
import { authGuard } from '../auth/middleware';
import { getDb } from '../db/client';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CHAT_ALLOWED_TOOLS = JSON.stringify(
  {
    permissions: {
      allow: ['Bash(*)', 'Read(*)', 'Edit(*)', 'Write(*)', 'WebFetch(*)', 'WebSearch(*)'],
      deny: [],
    },
  },
  null,
  2,
);

function ensureProjectClaudeSettings(projectDir: string): void {
  try {
    const claudeDir = join(projectDir, '.claude');
    const settingsPath = join(claudeDir, 'settings.json');
    if (existsSync(settingsPath)) return;
    if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });
    writeFileSync(settingsPath, CHAT_ALLOWED_TOOLS, 'utf8');
  } catch (err) {
    console.warn('[chat] could not write .claude/settings.json:', (err as Error).message);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRow = Record<string, any>;

interface SavedToolCall {
  id: string;
  name: string;
  input: unknown;
  result?: string;
  status: 'pending' | 'done' | 'error';
}

interface AssistantTurn {
  text: string;
  toolCalls: SavedToolCall[];
}

/**
 * In-memory map of chatSessionId → claude conversation session id.
 * Volatile: resets on server restart. Exported for testing/inspection.
 */
export const claudeSessionMap = new Map<string, string>();

function saveMessage(
  projectId: string,
  sessionId: string | null,
  role: 'user' | 'assistant',
  content: string,
  toolCallsJson?: string,
): void {
  try {
    const db = getDb();
    db.run(
      'INSERT INTO chat_messages (id, project_id, session_id, role, content, tool_calls_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [randomUUID(), projectId, sessionId, role, content, toolCallsJson ?? null, new Date().toISOString()],
    );
  } catch (err) {
    console.error('[chat] failed to persist message:', (err as Error).message);
  }
}

function setSessionTitle(sessionId: string, firstMessage: string): void {
  try {
    const db = getDb();
    db.run('UPDATE chat_sessions SET title = ? WHERE id = ? AND title IS NULL', [
      firstMessage.slice(0, 60),
      sessionId,
    ]);
  } catch {
    /* ignore */
  }
}

export const chatRoutes = new Elysia({ prefix: '/api/projects' }).guard(authGuard, (app) =>
  app
    // GET /api/projects/:id/chat/history — backward-compat: messages with no session
    .get('/:id/chat/history', ({ params, set }) => {
      const db = getDb();
      const project = db
        .query('SELECT id FROM projects WHERE id = ?')
        .get(params.id) as DbRow | null;
      if (!project) {
        set.status = 404;
        return { error: 'project not found' };
      }
      const rows = db
        .query(
          'SELECT id, role, content, tool_calls_json, created_at FROM chat_messages WHERE project_id = ? AND session_id IS NULL ORDER BY created_at ASC',
        )
        .all(params.id) as DbRow[];
      return rows.map((row) => ({
        id: row.id as string,
        role: row.role as 'user' | 'assistant',
        content: row.content as string,
        tool_calls: row.tool_calls_json ? (JSON.parse(row.tool_calls_json as string) as SavedToolCall[]) : undefined,
        created_at: row.created_at as string,
      }));
    })

    // GET /api/projects/:id/chat/sessions — list sessions, newest first
    .get('/:id/chat/sessions', ({ params, set }) => {
      const db = getDb();
      const project = db
        .query('SELECT id FROM projects WHERE id = ?')
        .get(params.id) as DbRow | null;
      if (!project) {
        set.status = 404;
        return { error: 'project not found' };
      }
      const rows = db
        .query(
          `SELECT s.id, s.title, s.created_at,
             (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id) AS message_count
           FROM chat_sessions s
           WHERE s.project_id = ?
           ORDER BY s.created_at DESC`,
        )
        .all(params.id) as DbRow[];
      return rows.map((r) => ({
        id: r.id as string,
        title: r.title as string | null,
        created_at: r.created_at as string,
        message_count: r.message_count as number,
      }));
    })

    // POST /api/projects/:id/chat/sessions — create a new session
    .post('/:id/chat/sessions', ({ params, set }) => {
      const db = getDb();
      const project = db
        .query('SELECT id FROM projects WHERE id = ?')
        .get(params.id) as DbRow | null;
      if (!project) {
        set.status = 404;
        return { error: 'project not found' };
      }
      const id = randomUUID();
      const now = new Date().toISOString();
      db.run('INSERT INTO chat_sessions (id, project_id, created_at) VALUES (?, ?, ?)', [
        id,
        params.id,
        now,
      ]);
      set.status = 201;
      return { id, title: null, created_at: now, message_count: 0 };
    })

    // GET /api/projects/:id/chat/sessions/:sessionId/messages
    .get('/:id/chat/sessions/:sessionId/messages', ({ params, set }) => {
      const db = getDb();
      const session = db
        .query('SELECT id FROM chat_sessions WHERE id = ? AND project_id = ?')
        .get(params.sessionId, params.id) as DbRow | null;
      if (!session) {
        set.status = 404;
        return { error: 'session not found' };
      }
      const rows = db
        .query(
          'SELECT id, role, content, tool_calls_json, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC',
        )
        .all(params.sessionId) as DbRow[];
      return rows.map((r) => ({
        id: r.id as string,
        role: r.role as 'user' | 'assistant',
        content: r.content as string,
        tool_calls: r.tool_calls_json
          ? (JSON.parse(r.tool_calls_json as string) as SavedToolCall[])
          : undefined,
        created_at: r.created_at as string,
      }));
    })

    // DELETE /api/projects/:id/chat/sessions/:sessionId
    .delete('/:id/chat/sessions/:sessionId', ({ params, set }) => {
      const db = getDb();
      const session = db
        .query('SELECT id FROM chat_sessions WHERE id = ? AND project_id = ?')
        .get(params.sessionId, params.id) as DbRow | null;
      if (!session) {
        set.status = 404;
        return { error: 'session not found' };
      }
      db.run('DELETE FROM chat_sessions WHERE id = ?', [params.sessionId]);
      claudeSessionMap.delete(params.sessionId);
      set.status = 200;
      return { deleted: true };
    })

    // POST /api/projects/:id/chat — send a message, stream Claude's reply as SSE
    .post('/:id/chat', async ({ params, request, set }) => {
      let body: { message?: string; sessionId?: string; model?: string; effort?: string };
      try {
        body = (await request.json()) as { message?: string; sessionId?: string; model?: string; effort?: string };
      } catch {
        set.status = 400;
        return { error: 'message is required' };
      }

      const message = typeof body.message === 'string' ? body.message.trim() : '';
      if (!message) {
        set.status = 400;
        return { error: 'message is required' };
      }

      const db = getDb();
      const project = db
        .query('SELECT id, directory FROM projects WHERE id = ?')
        .get(params.id) as DbRow | null;
      if (!project) {
        set.status = 404;
        return { error: 'project not found' };
      }

      // Validate or auto-create session
      let sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
      if (sessionId) {
        const session = db
          .query('SELECT id FROM chat_sessions WHERE id = ? AND project_id = ?')
          .get(sessionId, params.id) as DbRow | null;
        if (!session) {
          set.status = 400;
          return { error: 'invalid session' };
        }
      } else {
        sessionId = randomUUID();
        db.run('INSERT INTO chat_sessions (id, project_id, created_at) VALUES (?, ?, ?)', [
          sessionId,
          params.id,
          new Date().toISOString(),
        ]);
      }

      setSessionTitle(sessionId, message);
      saveMessage(params.id, sessionId, 'user', message);
      ensureProjectClaudeSettings(project.directory as string);

      const VALID_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
      const args = ['claude', '-p', message, '--output-format', 'stream-json', '--verbose'];
      if (body.model && /^[\w.-]+$/.test(body.model)) args.push('--model', body.model);
      if (body.effort && VALID_EFFORTS.has(body.effort)) args.push('--effort', body.effort);
      const priorSession = claudeSessionMap.get(sessionId);
      if (priorSession) args.push('--resume', priorSession);

      const spawn = (globalThis as { Bun?: { spawn: (...a: unknown[]) => unknown } }).Bun?.spawn;
      if (!spawn) {
        set.status = 500;
        return { error: 'claude runtime unavailable' };
      }

      const proc = spawn(args, {
        cwd: project.directory as string,
        stdout: 'pipe',
        stderr: 'ignore',
      }) as { stdout: ReadableStream<Uint8Array> };

      const projectId = params.id;
      const chatSessionId = sessionId;

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder();
          const decoder = new TextDecoder();

          // Track multiple assistant turns with their tool calls
          let completedTurns: AssistantTurn[] = [];
          let currentTurn: AssistantTurn = { text: '', toolCalls: [] };

          const flushTurn = () => {
            if (!currentTurn.text && currentTurn.toolCalls.length === 0) return;
            completedTurns = [...completedTurns, currentTurn];
            currentTurn = { text: '', toolCalls: [] };
          };

          const applyToolResult = (targetId: string, content: string) => {
            currentTurn.toolCalls = currentTurn.toolCalls.map((tc) =>
              tc.id === targetId ? { ...tc, result: content, status: 'done' as const } : tc,
            );
            completedTurns = completedTurns.map((turn) => ({
              ...turn,
              toolCalls: turn.toolCalls.map((tc) =>
                tc.id === targetId ? { ...tc, result: content, status: 'done' as const } : tc,
              ),
            }));
          };

          try {
            const reader = proc.stdout.getReader();
            let buffer = '';

            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() ?? '';

              for (const line of lines) {
                if (!line.trim()) continue;
                controller.enqueue(encoder.encode(`data: ${line}\n\n`));

                try {
                  const event = JSON.parse(line) as {
                    type?: string;
                    session_id?: string;
                    message?: {
                      content?: Array<{
                        type?: string;
                        text?: string;
                        id?: string;
                        name?: string;
                        input?: unknown;
                        tool_use_id?: string;
                        content?: Array<{ type?: string; text?: string }> | string;
                      }>;
                    };
                  };

                  if (event.type === 'assistant' && event.message?.content) {
                    flushTurn();
                    for (const block of event.message.content) {
                      if (block.type === 'text' && block.text) {
                        currentTurn.text += block.text;
                      } else if (block.type === 'tool_use' && block.id) {
                        currentTurn.toolCalls.push({
                          id: block.id,
                          name: block.name ?? 'tool',
                          input: block.input,
                          status: 'pending',
                        });
                      }
                    }
                  } else if (event.type === 'user' && event.message?.content) {
                    for (const block of event.message.content) {
                      if (block.type === 'tool_result' && block.tool_use_id) {
                        const resultContent = Array.isArray(block.content)
                          ? (block.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('')
                          : String(block.content ?? '');
                        applyToolResult(block.tool_use_id, resultContent);
                      }
                    }
                  } else if (event.type === 'result') {
                    if (event.session_id) claudeSessionMap.set(chatSessionId, event.session_id);

                    // Flush last turn and persist all
                    flushTurn();
                    for (const turn of completedTurns) {
                      if (!turn.text && turn.toolCalls.length === 0) continue;
                      saveMessage(
                        projectId,
                        chatSessionId,
                        'assistant',
                        turn.text,
                        turn.toolCalls.length > 0 ? JSON.stringify(turn.toolCalls) : undefined,
                      );
                    }
                  }
                } catch {
                  /* non-JSON line */
                }
              }
            }

            // Flush trailing line
            const tail = buffer.trim();
            if (tail) {
              controller.enqueue(encoder.encode(`data: ${tail}\n\n`));
              try {
                const event = JSON.parse(tail) as { type?: string; session_id?: string };
                if (event.type === 'result') {
                  if (event.session_id) claudeSessionMap.set(chatSessionId, event.session_id);
                  flushTurn();
                  for (const turn of completedTurns) {
                    if (!turn.text && turn.toolCalls.length === 0) continue;
                    saveMessage(
                      projectId,
                      chatSessionId,
                      'assistant',
                      turn.text,
                      turn.toolCalls.length > 0 ? JSON.stringify(turn.toolCalls) : undefined,
                    );
                  }
                }
              } catch {
                /* skip */
              }
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'stream error';
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`),
            );
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }),
);
