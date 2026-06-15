/** Badge components for displaying task types, GitHub links, and project info */

export interface GitHubLabel {
  name: string;
  color: string;
}

function labelTextColor(bgColor: string): string {
  // Simple luminance check — dark backgrounds get white text, light get dark
  const r = parseInt(bgColor.substring(0, 2), 16);
  const g = parseInt(bgColor.substring(2, 4), 16);
  const b = parseInt(bgColor.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#0a0a0f' : '#f0f0f0';
}

/** Badge for local tasks */
export function TaskBadge() {
  return (
    <span className="inline-flex items-center gap-[4px] rounded-[4px] border border-[rgba(100,140,255,0.2)] bg-[rgba(100,140,255,0.12)] px-[6px] py-[2px] font-['Inter'] text-[10px] font-medium text-[#8af]">
      Task
    </span>
  );
}

/** Badge for GitHub issues */
export function IssueBadge({ number }: { number: number }) {
  return (
    <span className="inline-flex items-center gap-[4px] rounded-[4px] border border-[rgba(255,255,255,0.08)] bg-[#24292e] px-[6px] py-[2px] font-['Inter'] text-[10px] font-medium text-[#f0f0f0]">
      <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1ZM4.5 8.5h7v-1h-7v1Z" />
      </svg>
      #{number}
    </span>
  );
}

/** GitHub label as colored badge */
export function LabelBadge({ label }: { label: GitHubLabel }) {
  const textColor = labelTextColor(label.color);
  return (
    <span
      className="inline-flex items-center rounded-[4px] px-[6px] py-[1px] font-['Inter'] text-[10px] font-medium"
      style={{ backgroundColor: `#${label.color}`, color: textColor }}
    >
      {label.name}
    </span>
  );
}

/**
 * Custom (project) colored label chip.
 *
 * Unlike GitHub's `LabelBadge` (which receives a 6-char hex without `#`),
 * custom labels store a full `#rgb`/`#rrggbb` value. We normalize to a 6-char
 * hex for the luminance contrast check used to pick readable text color.
 */
function normalizeHex(color: string): string {
  let hex = color.replace('#', '');
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  return hex;
}

export function LabelChip({
  name,
  color,
  onRemove,
}: {
  name: string;
  color: string;
  onRemove?: () => void;
}) {
  const textColor = labelTextColor(normalizeHex(color));
  return (
    <span
      className="inline-flex items-center gap-[4px] rounded-[4px] px-[6px] py-[1px] font-['Inter'] text-[10px] font-medium"
      style={{ backgroundColor: color, color: textColor }}
    >
      {name}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove label ${name}`}
          className="ml-[1px] flex size-[12px] items-center justify-center rounded-[3px] hover:bg-black/20"
          style={{ color: textColor }}
        >
          <svg width="7" height="7" viewBox="0 0 8 8" fill="none">
            <path
              d="M1 1l6 6M7 1l-6 6"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </span>
  );
}

/** Badge for project name */
export function ProjectBadge({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center rounded-[4px] border border-[rgba(255,255,255,0.06)] bg-[rgba(170,255,0,0.08)] px-[6px] py-[1px] font-['Inter'] text-[10px] font-medium text-[#af0]">
      {name}
    </span>
  );
}

/** Terminal/session icon badge */
export function SessionBadge() {
  return (
    <span
      className="inline-flex items-center gap-[3px] rounded-[4px] border border-[rgba(255,170,0,0.2)] bg-[rgba(255,170,0,0.08)] px-[5px] py-[1px] font-['Inter'] text-[10px] font-medium text-[#fa0]"
      title="Linked to session"
    >
      <svg width="9" height="9" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="3" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M5 11.5h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
      SSH
    </span>
  );
}
