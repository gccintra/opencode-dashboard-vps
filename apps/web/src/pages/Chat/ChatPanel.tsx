import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatMessage } from './ChatMessage';
import type { ChatMessageData, ChatSession, ToolCall } from './types';

function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Merge consecutive tool-only assistant turns into one combined message so
// history shows "5 actions ▾" instead of five separate "1 action ▾" sections.
function mergeToolTurns(turns: ChatMessageData[]): ChatMessageData[] {
  const out: ChatMessageData[] = [];
  for (const t of turns) {
    const last = out[out.length - 1];
    const isToolOnly = t.role === 'assistant' && !t.content && t.toolCalls && t.toolCalls.length > 0;
    const lastIsToolOnly =
      last &&
      last.role === 'assistant' &&
      !last.content &&
      last.toolCalls &&
      last.toolCalls.length > 0;

    if (isToolOnly && lastIsToolOnly) {
      last.toolCalls = [...(last.toolCalls ?? []), ...(t.toolCalls ?? [])];
    } else {
      out.push({ ...t });
    }
  }
  return out;
}

interface ChatPanelProps {
  projectId: string;
}

interface HistoryRow {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tool_calls?: ToolCall[];
  created_at: string;
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function ChatPanel({ projectId }: ChatPanelProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [input, setInput] = useState('');
  const [model, setModel] = useState('claude-sonnet-4-6');
  const [effort, setEffort] = useState('medium');
  const [streamingTurns, setStreamingTurns] = useState<ChatMessageData[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [pendingToolCalls, setPendingToolCalls] = useState<ToolCall[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const currentSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  const loadMessagesForSession = useCallback(
    async (sessionId: string, cancelled: { value: boolean }) => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/chat/sessions/${sessionId}/messages`,
          { headers: authHeaders() },
        );
        if (cancelled.value || !res.ok) return;
        const data = (await res.json()) as HistoryRow[];
        if (cancelled.value) return;

        setMessages(
          mergeToolTurns(
            data.map((r) => ({
              id: r.id,
              role: r.role,
              content: r.content,
              toolCalls: r.tool_calls,
            })),
          ),
        );
      } catch {
        /* keep panel usable */
      }
    },
    [projectId],
  );

  // Load sessions on mount / project change
  useEffect(() => {
    const cancelled = { value: false };

    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/chat/sessions`, {
          headers: authHeaders(),
        });
        if (cancelled.value || !res.ok) return;
        const data = (await res.json()) as ChatSession[];
        if (cancelled.value) return;
        setSessions(data);

        if (data.length > 0) {
          setCurrentSessionId(data[0].id);
          await loadMessagesForSession(data[0].id, cancelled);
        } else {
          // Auto-create first session
          const createRes = await fetch(`/api/projects/${projectId}/chat/sessions`, {
            method: 'POST',
            headers: authHeaders(),
          });
          if (cancelled.value || !createRes.ok) return;
          const session = (await createRes.json()) as ChatSession;
          if (cancelled.value) return;
          setSessions([session]);
          setCurrentSessionId(session.id);
        }
      } catch {
        /* keep panel usable */
      }
    })();

    return () => {
      cancelled.value = true;
    };
  }, [projectId, loadMessagesForSession]);

  // Auto-scroll on new content
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamingContent, pendingToolCalls]);

  const refreshSessions = useCallback(() => {
    fetch(`/api/projects/${projectId}/chat/sessions`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: ChatSession[] | null) => {
        if (data) setSessions(data);
      })
      .catch(() => {});
  }, [projectId]);

  const createNewSession = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/chat/sessions`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (!res.ok) return;
      const session = (await res.json()) as ChatSession;
      setSessions((prev) => [session, ...prev]);
      setCurrentSessionId(session.id);
      setMessages([]);
      setStreamingContent('');
      setPendingToolCalls([]);
      setError(null);
      setShowHistory(false);
    } catch {
      /* ignore */
    }
  }, [projectId]);

  const selectSession = useCallback(
    async (sessionId: string) => {
      if (isStreaming) return;
      setCurrentSessionId(sessionId);
      setMessages([]);
      setStreamingTurns([]);
      setStreamingContent('');
      setPendingToolCalls([]);
      setError(null);
      const cancelled = { value: false };
      await loadMessagesForSession(sessionId, cancelled);
      setShowHistory(false);
    },
    [isStreaming, loadMessagesForSession],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      const sessionId = currentSessionIdRef.current;
      if (!trimmed || isStreaming || !sessionId) return;

      setError(null);
      setMessages((prev) => [...prev, { id: genId(), role: 'user', content: trimmed }]);
      setInput('');
      setStreamingTurns([]);
      setStreamingContent('');
      setPendingToolCalls([]);
      setIsStreaming(true);

      // Track multiple assistant turns within a single response.
      // Each "assistant" event from claude is a separate conversational turn
      // (before tools, between tools, final answer). Tool results arrive
      // inside "user" events, not as top-level "tool_result" events.
      let completedTurns: ChatMessageData[] = [];
      let currentText = '';
      let currentTools: ToolCall[] = [];
      let finalized = false;

      const applyToolResult = (targetId: string, content: string) => {
        currentTools = currentTools.map((tc) =>
          tc.id === targetId ? { ...tc, result: content, status: 'done' as const } : tc,
        );
        completedTurns = completedTurns.map((turn) => ({
          ...turn,
          toolCalls: turn.toolCalls?.map((tc) =>
            tc.id === targetId ? { ...tc, result: content, status: 'done' as const } : tc,
          ),
        }));
        setPendingToolCalls([...currentTools]);
        setStreamingTurns([...completedTurns]);
      };

      const flushCurrentTurn = () => {
        if (!currentText && currentTools.length === 0) return;
        const turn: ChatMessageData = {
          id: genId(),
          role: 'assistant',
          content: currentText,
          toolCalls: currentTools.length > 0 ? [...currentTools] : undefined,
        };
        completedTurns = [...completedTurns, turn];
        setStreamingTurns([...completedTurns]);
        currentText = '';
        currentTools = [];
        setStreamingContent('');
        setPendingToolCalls([]);
      };

      const finalize = () => {
        if (finalized) return;
        finalized = true;

        // Flush any in-progress turn
        if (currentText || currentTools.length > 0) {
          completedTurns = [
            ...completedTurns,
            {
              id: genId(),
              role: 'assistant',
              content: currentText,
              toolCalls: currentTools.length > 0 ? [...currentTools] : undefined,
            },
          ];
        }

        if (completedTurns.length > 0) {
          setMessages((prev) => mergeToolTurns([...prev, ...completedTurns]));
        }
        setStreamingTurns([]);
        setStreamingContent('');
        setPendingToolCalls([]);
        setIsStreaming(false);
        refreshSessions();
      };

      const processEvent = (event: Record<string, unknown>) => {
        const type = event.type as string | undefined;

        if (type === 'assistant') {
          // New assistant turn — flush previous turn first
          flushCurrentTurn();

          const msg = event.message as
            | {
                content?: Array<{
                  type?: string;
                  text?: string;
                  id?: string;
                  name?: string;
                  input?: unknown;
                }>;
              }
            | undefined;
          for (const block of msg?.content ?? []) {
            if (block.type === 'text' && block.text) {
              currentText += block.text;
              setStreamingContent((prev) => prev + (block.text ?? ''));
            } else if (block.type === 'tool_use') {
              const tc: ToolCall = {
                id: String(block.id ?? genId()),
                name: String(block.name ?? 'tool'),
                input: block.input,
                status: 'pending',
              };
              currentTools = [...currentTools, tc];
              setPendingToolCalls([...currentTools]);
            }
          }
        } else if (type === 'user') {
          // Tool results arrive inside user-role messages
          const msg = event.message as
            | {
                content?: Array<{
                  type?: string;
                  tool_use_id?: string;
                  content?: Array<{ type?: string; text?: string }> | string;
                }>;
              }
            | undefined;
          for (const block of msg?.content ?? []) {
            if (block.type === 'tool_result' && block.tool_use_id) {
              const resultContent = Array.isArray(block.content)
                ? (block.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('')
                : String(block.content ?? '');
              applyToolResult(block.tool_use_id, resultContent);
            }
          }
        } else if (type === 'tool_use') {
          // Top-level tool_use (some claude versions)
          const tc: ToolCall = {
            id: String(event.id ?? genId()),
            name: String(event.name ?? 'tool'),
            input: event.input,
            status: 'pending',
          };
          currentTools = [...currentTools, tc];
          setPendingToolCalls([...currentTools]);
        } else if (type === 'tool_result') {
          // Top-level tool_result (some claude versions)
          const raw = event.content;
          const content = Array.isArray(raw)
            ? (raw as Array<{ text?: string }>).map((c) => c.text ?? '').join('')
            : String(raw ?? '');
          const targetId = event.tool_use_id as string | undefined;
          if (targetId) applyToolResult(targetId, content);
        } else if (type === 'result') {
          finalize();
        } else if (type === 'error') {
          setError(String(event.message ?? 'stream error'));
          setIsStreaming(false);
        }
      };

      try {
        const response = await fetch(`/api/projects/${projectId}/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders(),
          },
          body: JSON.stringify({ message: trimmed, sessionId, model, effort }),
        });

        if (!response.ok || !response.body) {
          setError(`request failed (${response.status})`);
          setIsStreaming(false);
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          const parts = buf.split('\n\n');
          buf = parts.pop() ?? '';

          for (const part of parts) {
            const line = part.replace(/^data: /, '').trim();
            if (!line) continue;
            try {
              processEvent(JSON.parse(line) as Record<string, unknown>);
            } catch {
              /* ignore malformed line */
            }
          }
        }

        // Stream closed — finalize if the 'result' event never arrived.
        if (currentText || currentTools.length > 0 || completedTurns.length > 0) {
          finalize();
        } else if (!finalized) {
          setIsStreaming(false);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'network error');
        setIsStreaming(false);
      }
    },
    [projectId, isStreaming, refreshSessions, model, effort],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendMessage(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  };

  const currentSession = sessions.find((s) => s.id === currentSessionId);
  const hasContent = messages.length > 0 || isStreaming;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-[#0a0a0f]" data-testid="chat-panel">
      {/* ── Header ── */}
      <div className="flex shrink-0 flex-col border-b border-white/[0.07]">
        {/* Row 1: session title + new button */}
        <div className="flex items-center justify-between px-[14px] py-[8px]">
          <button
            type="button"
            onClick={() => setShowHistory(true)}
            className="flex min-w-0 items-center gap-[6px] text-left"
            title="Chat history"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="shrink-0 text-[#556]"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span className="max-w-[180px] truncate font-['Inter'] text-[12px] text-[#889]">
              {currentSession?.title ?? 'Chat'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => void createNewSession()}
            className="ml-[8px] shrink-0 rounded-[6px] border border-[#b3e502]/20 bg-[#b3e502]/[0.06] px-[10px] py-[4px] font-['Inter'] text-[11px] font-medium text-[#b3e502] transition-opacity hover:opacity-80"
            title="New chat"
          >
            + New
          </button>
        </div>

        {/* Row 2: model + effort selects */}
        <div className="flex items-center gap-[8px] border-t border-white/[0.04] px-[14px] py-[6px]">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={isStreaming}
            className="min-w-0 flex-1 rounded-[6px] border border-white/[0.07] bg-[#111118] px-[8px] py-[4px] font-['Inter'] text-[11px] text-[#889] outline-none focus:border-[#b3e502]/30 disabled:opacity-50"
          >
            <option value="claude-haiku-4-5-20251001">Haiku 4.5 — fast</option>
            <option value="claude-sonnet-4-6">Sonnet 4.6 — balanced</option>
            <option value="claude-opus-4-8">Opus 4.8 — powerful</option>
          </select>

          <select
            value={effort}
            onChange={(e) => setEffort(e.target.value)}
            disabled={isStreaming}
            className="rounded-[6px] border border-white/[0.07] bg-[#111118] px-[8px] py-[4px] font-['Inter'] text-[11px] text-[#889] outline-none focus:border-[#b3e502]/30 disabled:opacity-50"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="xhigh">X-High</option>
            <option value="max">Max</option>
          </select>
        </div>
      </div>

      {/* ── History overlay ── */}
      {showHistory && (
        <div className="absolute inset-0 z-20 flex flex-col bg-[#0a0a0f]">
          <div className="flex shrink-0 items-center justify-between border-b border-white/[0.07] px-[14px] py-[10px]">
            <span className="font-['Inter'] text-[13px] font-semibold text-[#f0f0f0]">
              History
            </span>
            <button
              type="button"
              onClick={() => setShowHistory(false)}
              className="flex h-[26px] w-[26px] items-center justify-center rounded-[6px] text-[16px] text-[#556] hover:text-[#889]"
              aria-label="Close history"
            >
              ✕
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {sessions.length === 0 ? (
              <div className="flex h-full items-center justify-center text-[12px] text-[#556]">
                No chats yet
              </div>
            ) : (
              sessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => void selectSession(s.id)}
                  className={`flex w-full flex-col items-start border-b border-white/[0.04] px-[14px] py-[10px] text-left transition-colors hover:bg-white/[0.02] ${
                    s.id === currentSessionId ? 'bg-white/[0.03]' : ''
                  }`}
                >
                  <span className="w-full truncate font-['Inter'] text-[12px] text-[#e6e8eb]">
                    {s.title ?? 'Untitled chat'}
                  </span>
                  <span className="mt-[2px] font-['Inter'] text-[11px] text-[#556]">
                    {s.message_count} msg{s.message_count !== 1 ? 's' : ''} ·{' '}
                    {formatRelativeDate(s.created_at)}
                  </span>
                </button>
              ))
            )}
          </div>

          <div className="shrink-0 border-t border-white/[0.07] p-[12px]">
            <button
              type="button"
              onClick={() => void createNewSession()}
              className="w-full rounded-[8px] border border-[#b3e502]/20 bg-[#b3e502]/[0.06] py-[8px] font-['Inter'] text-[12px] font-medium text-[#b3e502] transition-opacity hover:opacity-80"
            >
              + New Chat
            </button>
          </div>
        </div>
      )}

      {/* ── Message list ── */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-[10px] overflow-y-auto px-[16px] py-[16px]"
        data-testid="chat-messages"
      >
        {!hasContent && (
          <div className="flex h-full items-center justify-center text-center text-[13px] text-[#556]">
            <p className="max-w-[280px] font-['Inter']">
              Start a conversation with Claude in this project.
            </p>
          </div>
        )}

        {messages.map((m) => (
          <ChatMessage key={m.id} message={m} />
        ))}

        {/* Completed turns from current streaming response */}
        {streamingTurns.map((m) => (
          <ChatMessage key={m.id} message={m} />
        ))}

        {/* Current in-progress assistant turn */}
        {isStreaming && (
          <ChatMessage
            message={{
              id: 'streaming',
              role: 'assistant',
              content: streamingContent,
              toolCalls: pendingToolCalls.length > 0 ? pendingToolCalls : undefined,
            }}
            streaming
          />
        )}
      </div>

      {error && (
        <div
          className="mx-[16px] mb-[8px] rounded-[8px] border border-[#ff5c5c]/30 bg-[#ff5c5c]/10 px-[12px] py-[8px] text-[12px] text-[#ff9c9c]"
          data-testid="chat-error"
          role="alert"
        >
          {error}
        </div>
      )}

      {/* ── Input ── */}
      <form
        onSubmit={handleSubmit}
        className="shrink-0 border-t border-white/[0.07] bg-[#0a0a0f] p-[12px]"
      >
        <div className="flex items-end gap-[8px] rounded-[8px] border border-white/[0.08] bg-[#111118] px-[10px] py-[8px] focus-within:border-[#b3e502]/40">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Claude…"
            rows={1}
            className="max-h-[140px] min-h-[22px] flex-1 resize-none bg-transparent font-['Inter'] text-[13px] text-[#f0f0f0] outline-none placeholder:text-[#556]"
            data-testid="chat-input"
            disabled={isStreaming}
          />
          <button
            type="submit"
            disabled={isStreaming || !input.trim()}
            className="shrink-0 rounded-[6px] bg-[#b3e502] px-[12px] py-[6px] font-['Inter'] text-[12px] font-semibold text-[#0a0a0f] transition-opacity disabled:opacity-40"
            data-testid="chat-send"
          >
            {isStreaming ? '…' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default ChatPanel;
