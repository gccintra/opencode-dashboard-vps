import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '../lib/api';

interface Conversation {
  id: string;
  cwd: string;
  firstMessage: string;
  timestamp: string;
  mtime: number;
  source: 'claude' | 'opencode';
  projectId: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onRecover: (
    projectId: string,
    conversationId: string,
    sessionName: string,
    agentType: 'claude' | 'opencode',
  ) => Promise<void>;
}

function relativeDate(mtime: number): string {
  const diff = Date.now() - mtime;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 0)}m atrás`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h atrás`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d atrás`;
  return new Date(mtime).toLocaleDateString('pt-BR');
}

function truncateLeft(value: string, max: number): string {
  if (value.length <= max) return value;
  return `…${value.slice(value.length - max)}`;
}

// Official Claude logo from simple-icons (viewBox 0 0 24 24)
const CLAUDE_PATH =
  'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z';

// Official OpenCode logo from simple-icons (viewBox 0 0 24 24) — outer rect + inner rect
const OPENCODE_PATH = 'M22 24H2V0h20zM17 4.8H7v14.4h10z';

function ClaudeIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d={CLAUDE_PATH} />
    </svg>
  );
}

function OpenCodeIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d={OPENCODE_PATH} />
    </svg>
  );
}

function SourceIcon({ source, size }: { source: 'claude' | 'opencode'; size?: number }) {
  return source === 'claude' ? <ClaudeIcon size={size} /> : <OpenCodeIcon size={size} />;
}

function ConversationRow({
  c,
  isSelected,
  showSource,
  onClick,
}: {
  c: Conversation;
  isSelected: boolean;
  showSource: boolean;
  onClick: () => void;
}) {
  const iconColor = c.source === 'claude' ? 'text-[#e8784d]' : 'text-[#a78bfa]';
  return (
    <button
      onClick={onClick}
      className={`mb-[5px] flex w-full items-start gap-[8px] rounded-[10px] border px-[10px] py-[9px] text-left transition-all ${
        isSelected
          ? 'border-[rgba(170,255,0,0.45)] bg-[rgba(170,255,0,0.07)]'
          : 'border-white/[0.05] hover:border-white/[0.12] hover:bg-white/[0.025]'
      }`}
    >
      {showSource && (
        <span className={`mt-[1px] shrink-0 ${iconColor}`}>
          <SourceIcon source={c.source} size={13} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex w-full items-start justify-between gap-2">
          <span className="truncate text-[12px] font-medium leading-snug text-[#e0e0e0]">
            {c.firstMessage.slice(0, 80)}
          </span>
          <span className="shrink-0 text-[10px] text-[#445]">{relativeDate(c.mtime)}</span>
        </div>
        <span className="mt-[2px] block truncate font-['JetBrains_Mono',monospace] text-[10px] text-[#3a4050]">
          {truncateLeft(c.cwd, 46)}
        </span>
      </div>
    </button>
  );
}

export default function RecoverConversationModal({ open, onClose, onRecover }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [activeSource, setActiveSource] = useState<'claude' | 'opencode'>('claude');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedId(null);
    setSearch('');
    apiFetch<{ conversations: Conversation[] }>('/api/conversations')
      .then((res) => {
        if (!cancelled) setConversations(res.conversations ?? []);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Falha ao carregar conversas');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const claudeConvs = useMemo(
    () => conversations.filter((c) => c.source === 'claude'),
    [conversations],
  );
  const opencodeConvs = useMemo(
    () => conversations.filter((c) => c.source === 'opencode'),
    [conversations],
  );

  const q = search.trim().toLowerCase();

  // Search: flat across both sources. Browse: only active source.
  const displayed = useMemo(() => {
    if (q) {
      return conversations.filter(
        (c) => c.firstMessage.toLowerCase().includes(q) || c.cwd.toLowerCase().includes(q),
      );
    }
    return activeSource === 'claude' ? claudeConvs : opencodeConvs;
  }, [conversations, q, activeSource, claudeConvs, opencodeConvs]);

  const selected = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  const handleConfirm = useCallback(async () => {
    if (!selected || !selected.projectId || recovering) return;
    setRecovering(true);
    try {
      await onRecover(
        selected.projectId,
        selected.id,
        selected.firstMessage.slice(0, 50),
        selected.source,
      );
      onClose();
    } finally {
      setRecovering(false);
    }
  }, [selected, recovering, onRecover, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="mx-4 flex max-h-[88vh] w-full max-w-[520px] flex-col rounded-[18px] border border-white/[0.08] bg-[#0d0d14] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between px-5 pt-4 pb-3">
          <h2 className="text-[15px] font-bold text-[#f0f0f0]">
            Recuperar Conversa
          </h2>
          <button
            onClick={onClose}
            className="flex size-[28px] items-center justify-center rounded-[7px] text-[#445] transition-colors hover:bg-white/[0.06] hover:text-[#c0c0c0]"
            aria-label="Fechar"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M2 2l8 8M10 2L2 10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Source tabs */}
        <div className="shrink-0 flex gap-[8px] px-5 pb-3">
          <button
            onClick={() => { setActiveSource('claude'); setSelectedId(null); }}
            className={`flex flex-1 items-center justify-center gap-[8px] rounded-[12px] border py-[10px] px-3 transition-all ${
              activeSource === 'claude' && !q
                ? 'border-[rgba(232,120,77,0.45)] bg-[rgba(232,120,77,0.08)] text-[#e8784d]'
                : 'border-white/[0.06] text-[#556] hover:border-white/[0.12] hover:text-[#889]'
            }`}
          >
            <ClaudeIcon size={18} />
            <span className="text-[12px] font-semibold">Claude Code</span>
            {!loading && (
              <span
                className={`rounded-[5px] px-[5px] py-[1px] text-[10px] font-medium ${
                  activeSource === 'claude' && !q
                    ? 'bg-[rgba(232,120,77,0.15)] text-[#e8784d]'
                    : 'bg-white/[0.05] text-[#445]'
                }`}
              >
                {claudeConvs.length}
              </span>
            )}
          </button>

          <button
            onClick={() => { setActiveSource('opencode'); setSelectedId(null); }}
            className={`flex flex-1 items-center justify-center gap-[8px] rounded-[12px] border py-[10px] px-3 transition-all ${
              activeSource === 'opencode' && !q
                ? 'border-[rgba(167,139,250,0.45)] bg-[rgba(167,139,250,0.08)] text-[#a78bfa]'
                : 'border-white/[0.06] text-[#556] hover:border-white/[0.12] hover:text-[#889]'
            }`}
          >
            <OpenCodeIcon size={18} />
            <span className="text-[12px] font-semibold">OpenCode</span>
            {!loading && (
              <span
                className={`rounded-[5px] px-[5px] py-[1px] text-[10px] font-medium ${
                  activeSource === 'opencode' && !q
                    ? 'bg-[rgba(167,139,250,0.15)] text-[#a78bfa]'
                    : 'bg-white/[0.05] text-[#445]'
                }`}
              >
                {opencodeConvs.length}
              </span>
            )}
          </button>
        </div>

        {/* Search */}
        <div className="shrink-0 px-5 pb-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por mensagem ou diretório…"
            className="w-full rounded-[9px] border border-white/[0.07] bg-[#0a0a0f] px-3 py-[7px] text-[12px] text-[#e0e0e0] placeholder-[#334] outline-none transition-colors focus:border-[rgba(170,255,0,0.3)]"
          />
        </div>

        {/* List */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-2 pt-1">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <svg className="h-5 w-5 animate-spin text-[#af0]" viewBox="0 0 24 24" fill="none">
                <circle
                  className="opacity-20"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="3"
                />
                <path
                  className="opacity-80"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z"
                />
              </svg>
            </div>
          )}

          {!loading && error && (
            <div className="py-8 text-center text-[12px] text-[#f87171]">{error}</div>
          )}

          {!loading && !error && displayed.length === 0 && (
            <div className="py-10 text-center text-[12px] text-[#445]">
              {q
                ? `Sem resultados para "${search}"`
                : `Nenhuma conversa de ${activeSource === 'claude' ? 'Claude Code' : 'OpenCode'}.`}
            </div>
          )}

          {!loading &&
            !error &&
            displayed.map((c) => (
              <ConversationRow
                key={c.id}
                c={c}
                isSelected={c.id === selectedId}
                showSource={!!q}
                onClick={() => setSelectedId(c.id)}
              />
            ))}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-white/[0.06] px-5 py-3">
          <div className="flex items-center justify-end gap-[6px]">
            <button
              onClick={onClose}
              className="rounded-[9px] border border-white/[0.07] px-4 py-[7px] text-[12px] text-[#6a7280] transition-colors hover:text-[#c0c4cc]"
            >
              Cancelar
            </button>
            <button
              onClick={handleConfirm}
              disabled={!selected || !selected.projectId || recovering}
              className="rounded-[9px] bg-[#af0] px-4 py-[7px] text-[12px] font-semibold text-[#0a0a0f] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {recovering ? 'Recuperando…' : 'Recuperar'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
