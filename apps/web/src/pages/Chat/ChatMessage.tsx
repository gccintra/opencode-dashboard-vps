import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ToolCallCard } from './ToolCallCard';
import type { ChatMessageData } from './types';

interface ChatMessageProps {
  message: ChatMessageData;
  /** When true, renders a blinking cursor after the content (active stream). */
  streaming?: boolean;
}

/** Markdown renderer with design-system styles */
function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => (
          <p className="mb-[0.6em] last:mb-0 whitespace-pre-wrap break-words leading-[1.6]">{children}</p>
        ),
        h1: ({ children }) => (
          <h1 className="mb-[0.5em] mt-[0.8em] font-['Inter'] text-[15px] font-bold text-[#f0f0f0] first:mt-0">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="mb-[0.4em] mt-[0.7em] font-['Inter'] text-[14px] font-semibold text-[#f0f0f0] first:mt-0">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="mb-[0.3em] mt-[0.6em] font-['Inter'] text-[13px] font-semibold text-[#e6e8eb] first:mt-0">{children}</h3>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-[#f0f0f0]">{children}</strong>
        ),
        em: ({ children }) => (
          <em className="italic text-[#c8ccd0]">{children}</em>
        ),
        code: ({ children, className }) => {
          const isBlock = className?.startsWith('language-');
          if (isBlock) {
            return (
              <code className="block font-['JetBrains_Mono']">{children}</code>
            );
          }
          return (
            <code className="rounded-[4px] bg-black/40 px-[5px] py-[1px] font-['JetBrains_Mono'] text-[11px] text-[#b3e502]">
              {children}
            </code>
          );
        },
        pre: ({ children }) => (
          <pre className="my-[0.5em] overflow-x-auto rounded-[6px] bg-black/40 px-[10px] py-[8px] font-['JetBrains_Mono'] text-[11px] leading-[1.6] text-[#b3c0cc]">
            {children}
          </pre>
        ),
        ul: ({ children }) => (
          <ul className="mb-[0.5em] ml-[1em] list-disc space-y-[2px] [&>li]:pl-[2px]">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-[0.5em] ml-[1em] list-decimal space-y-[2px] [&>li]:pl-[2px]">{children}</ol>
        ),
        li: ({ children }) => (
          <li className="leading-[1.5]">{children}</li>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-[0.4em] border-l-[2px] border-[#b3e502]/40 pl-[10px] text-[#889] italic">
            {children}
          </blockquote>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#b3e502] underline underline-offset-2 hover:opacity-80"
          >
            {children}
          </a>
        ),
        hr: () => <hr className="my-[0.6em] border-white/10" />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

export function ChatMessage({ message, streaming = false }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const [actionsOpen, setActionsOpen] = useState(true);
  const hasTools = !isUser && !!message.toolCalls && message.toolCalls.length > 0;
  const hasText = !!message.content;
  const allDone = hasTools && message.toolCalls!.every((tc) => tc.status === 'done');

  const showTextBubble = hasText || (streaming && !hasTools);

  return (
    <div
      className={`flex w-full flex-col ${isUser ? 'items-end justify-end' : 'items-start justify-start'}`}
      data-testid="chat-message"
      data-role={message.role}
    >
      {/* Collapsible "Actions" section — assistant tool calls */}
      {hasTools && (
        <div
          className="mb-[6px] w-full max-w-[85%] sm:max-w-[75%]"
          data-testid="chat-message-tools"
        >
          <button
            type="button"
            onClick={() => setActionsOpen((v) => !v)}
            className="mb-[4px] flex items-center gap-[5px] font-['Inter'] text-[11px] text-[#556] transition-colors hover:text-[#889]"
          >
            <span className="text-[9px]">{actionsOpen ? '▾' : '▸'}</span>
            <span>
              {message.toolCalls!.length} action{message.toolCalls!.length !== 1 ? 's' : ''}
              {!allDone && streaming ? ' · running…' : ''}
            </span>
          </button>
          {actionsOpen && (
            <div className="space-y-[4px]">
              {message.toolCalls!.map((tc) => (
                <ToolCallCard key={tc.id} toolCall={tc} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Text bubble */}
      {showTextBubble && (
        <div
          className={`max-w-[85%] rounded-[12px] px-[12px] py-[9px] text-[13px] leading-[1.5] sm:max-w-[75%] ${
            isUser
              ? 'border border-[#b3e502]/20 bg-[#b3e502]/10 text-[#e6e8eb]'
              : 'border border-white/[0.07] bg-[#111118] text-[#f0f0f0]'
          }`}
        >
          {!hasText && streaming && (
            <span className="text-[#556]">Thinking…</span>
          )}

          {hasText && (
            isUser ? (
              <span className="whitespace-pre-wrap break-words font-['Inter']">
                {message.content}
              </span>
            ) : (
              <div className="font-['Inter']">
                <MarkdownContent content={message.content} />
              </div>
            )
          )}

          {streaming && (
            <span
              className="ml-[2px] inline-block h-[14px] w-[2px] animate-pulse bg-[#b3e502] align-middle"
              data-testid="streaming-cursor"
              aria-hidden="true"
            />
          )}
        </div>
      )}
    </div>
  );
}
