import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownProps {
  children: string;
  className?: string;
}

/**
 * Sanitized markdown renderer.
 *
 * Security: we deliberately do NOT use `rehype-raw`, so any raw HTML embedded
 * in the markdown source is rendered as literal text rather than parsed into
 * DOM nodes. This is the primary XSS mitigation — user-authored task bodies
 * cannot inject <script>, <img onerror>, etc.
 *
 * Links are forced to open in a new tab with `rel="noopener noreferrer"` and
 * are restricted to http/https/mailto schemes to block `javascript:` URIs.
 */
const SAFE_PROTOCOL = /^(https?:|mailto:)/i;

function safeHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  const trimmed = href.trim();
  // Allow same-page anchors and relative paths; block dangerous schemes.
  if (trimmed.startsWith('#') || trimmed.startsWith('/')) return trimmed;
  if (SAFE_PROTOCOL.test(trimmed)) return trimmed;
  return undefined;
}

export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div
      className={
        'prose-invert max-w-none font-["Inter"] text-[14px] leading-[1.6] text-[#d4d4dc] ' +
        '[&_a]:text-[#af0] [&_a]:underline ' +
        '[&_h1]:mb-[8px] [&_h1]:mt-[16px] [&_h1]:text-[20px] [&_h1]:font-semibold [&_h1]:text-[#f0f0f0] ' +
        '[&_h2]:mb-[6px] [&_h2]:mt-[14px] [&_h2]:text-[17px] [&_h2]:font-semibold [&_h2]:text-[#f0f0f0] ' +
        '[&_h3]:mb-[4px] [&_h3]:mt-[12px] [&_h3]:text-[15px] [&_h3]:font-semibold [&_h3]:text-[#f0f0f0] ' +
        '[&_p]:my-[8px] ' +
        '[&_ul]:my-[8px] [&_ul]:list-disc [&_ul]:pl-[20px] ' +
        '[&_ol]:my-[8px] [&_ol]:list-decimal [&_ol]:pl-[20px] ' +
        '[&_li]:my-[2px] ' +
        '[&_code]:rounded-[4px] [&_code]:bg-[rgba(255,255,255,0.06)] [&_code]:px-[5px] [&_code]:py-[1px] [&_code]:font-["JetBrains_Mono"] [&_code]:text-[12.5px] [&_code]:text-[#af0] ' +
        '[&_pre]:my-[10px] [&_pre]:overflow-x-auto [&_pre]:rounded-[8px] [&_pre]:border [&_pre]:border-[rgba(255,255,255,0.08)] [&_pre]:bg-[#0a0a0f] [&_pre]:p-[12px] ' +
        '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[#d4d4dc] ' +
        '[&_blockquote]:my-[8px] [&_blockquote]:border-l-[3px] [&_blockquote]:border-[rgba(170,255,0,0.4)] [&_blockquote]:pl-[12px] [&_blockquote]:text-[#889] ' +
        '[&_table]:my-[10px] [&_table]:w-full [&_table]:border-collapse ' +
        '[&_th]:border [&_th]:border-[rgba(255,255,255,0.08)] [&_th]:px-[8px] [&_th]:py-[4px] [&_th]:text-left [&_th]:text-[#f0f0f0] ' +
        '[&_td]:border [&_td]:border-[rgba(255,255,255,0.08)] [&_td]:px-[8px] [&_td]:py-[4px] ' +
        '[&_input]:mr-[6px] ' +
        (className ? ' ' + className : '')
      }
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // No rehype-raw: raw HTML in the source is treated as plain text.
        components={{
          a: ({ href, children: linkChildren, ...rest }) => {
            const safe = safeHref(href);
            if (!safe) {
              return <span {...rest}>{linkChildren}</span>;
            }
            return (
              <a href={safe} target="_blank" rel="noopener noreferrer" {...rest}>
                {linkChildren}
              </a>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export default Markdown;
