import { useState } from 'react';
import type { ToolCall } from './types';

// ── Tool icons (text-based, no deps) ──────────────────────────────────────────
function ToolIcon({ name }: { name: string }) {
  const n = name.toLowerCase();
  if (n.includes('bash') || n.includes('shell') || n.includes('exec')) {
    return <span className="text-[#b3e502]">$_</span>;
  }
  if (n.includes('read') || n.includes('file') || n.includes('glob')) {
    return <span className="text-[#7dd3fc]">▤</span>;
  }
  if (n.includes('edit') || n.includes('write') || n.includes('patch')) {
    return <span className="text-[#f9a8d4]">✎</span>;
  }
  if (n.includes('web') || n.includes('fetch') || n.includes('search')) {
    return <span className="text-[#fbbf24]">⊕</span>;
  }
  if (n.includes('grep') || n.includes('find') || n.includes('search')) {
    return <span className="text-[#c084fc]">⌕</span>;
  }
  return <span className="text-[#889]">⚙</span>;
}

function formatInput(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function truncate(s: string, max: number): { text: string; truncated: boolean } {
  if (s.length <= max) return { text: s, truncated: false };
  return { text: s.slice(0, max), truncated: true };
}

interface ToolCallCardProps {
  toolCall: ToolCall;
}

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showFullResult, setShowFullResult] = useState(false);

  const inputText = formatInput(toolCall.input);
  const resultText = toolCall.result ?? '';
  const { text: truncatedResult, truncated: resultTruncated } = truncate(resultText, 800);

  const isPending = toolCall.status === 'pending';
  const isDone = toolCall.status === 'done';
  const isError = toolCall.status === 'error';

  return (
    <div
      className={`rounded-[10px] border text-[12px] transition-colors ${
        isPending
          ? 'border-[#e0a800]/30 bg-[#e0a800]/[0.04]'
          : isDone
            ? 'border-white/[0.07] bg-white/[0.02]'
            : 'border-[#ff5c5c]/30 bg-[#ff5c5c]/[0.04]'
      }`}
      data-testid="tool-call-card"
    >
      {/* ── Header ── */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-[8px] px-[10px] py-[8px] text-left"
        data-testid="tool-call-toggle"
      >
        {/* Status indicator */}
        <span className="relative flex h-[8px] w-[8px] shrink-0" data-testid="tool-call-status-dot" data-status={toolCall.status}>
          {isPending && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#e0a800] opacity-60" />
          )}
          <span
            className={`relative inline-flex h-[8px] w-[8px] rounded-full ${
              isPending ? 'bg-[#e0a800]' : isDone ? 'bg-[#b3e502]' : 'bg-[#ff5c5c]'
            }`}
          />
        </span>

        {/* Icon + name */}
        <span className="font-['JetBrains_Mono'] text-[11px] font-semibold leading-none">
          <ToolIcon name={toolCall.name} />
        </span>
        <span className="font-['JetBrains_Mono'] text-[12px] font-medium text-[#e6e8eb]">
          {toolCall.name}
        </span>

        {/* Brief input preview */}
        {inputText && !expanded && (
          <span className="min-w-0 flex-1 truncate font-['JetBrains_Mono'] text-[11px] text-[#556]">
            {inputText.split('\n')[0].slice(0, 60)}
          </span>
        )}

        {/* Status label */}
        <span
          className={`ml-auto shrink-0 rounded-[4px] px-[6px] py-[2px] font-['Inter'] text-[10px] uppercase tracking-wide ${
            isPending
              ? 'bg-[#e0a800]/10 text-[#e0a800]'
              : isDone
                ? 'bg-[#b3e502]/10 text-[#b3e502]'
                : 'bg-[#ff5c5c]/10 text-[#ff5c5c]'
          }`}
        >
          {isPending ? 'running' : isDone ? 'done' : 'error'}
        </span>

        {/* Expand chevron */}
        <span className="ml-[4px] shrink-0 text-[10px] text-[#556]" aria-hidden="true">
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {/* ── Expanded body ── */}
      {expanded && (
        <div
          className="border-t border-white/[0.05] px-[10px] py-[8px] space-y-[10px]"
          data-testid="tool-call-body"
        >
          {/* Input */}
          {inputText && (
            <div>
              <div className="mb-[4px] font-['Inter'] text-[10px] uppercase tracking-wider text-[#556]">
                Input
              </div>
              <pre className="overflow-x-auto rounded-[6px] bg-black/30 px-[10px] py-[8px] font-['JetBrains_Mono'] text-[11px] leading-[1.6] text-[#b3c0cc] whitespace-pre-wrap break-words">
                {inputText}
              </pre>
            </div>
          )}

          {/* Result */}
          {resultText && (
            <div>
              <div className="mb-[4px] font-['Inter'] text-[10px] uppercase tracking-wider text-[#556]">
                Output
              </div>
              <pre className="overflow-x-auto rounded-[6px] bg-black/30 px-[10px] py-[8px] font-['JetBrains_Mono'] text-[11px] leading-[1.6] text-[#9aa3ad] whitespace-pre-wrap break-words">
                {showFullResult ? resultText : truncatedResult}
              </pre>
              {resultTruncated && (
                <button
                  type="button"
                  onClick={() => setShowFullResult((v) => !v)}
                  className="mt-[4px] font-['Inter'] text-[10px] text-[#b3e502]/70 hover:text-[#b3e502] transition-colors"
                >
                  {showFullResult ? '▲ show less' : `▼ show more (${resultText.length - 800} chars)`}
                </button>
              )}
            </div>
          )}

          {/* Pending — no result yet */}
          {isPending && !resultText && (
            <div className="flex items-center gap-[6px] text-[11px] text-[#556]">
              <span className="inline-block h-[2px] w-[12px] animate-pulse rounded bg-[#e0a800]" />
              Waiting for result…
            </div>
          )}
        </div>
      )}
    </div>
  );
}
