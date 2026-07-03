import { useState, useCallback, type MouseEvent } from 'react';
import type { FileEntry } from '../../lib/api';

/* ── Props ── */

export interface HarnessFileTreeProps {
  files: FileEntry[];
  onFileClick?: (path: string) => void;
  conflictPaths?: Set<string>;
}

/* ── Helpers ── */

/** Extract the display name from a relative path. */
function fileNameFromPath(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(idx + 1) : path;
}

/** Format bytes into a human-readable string. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/* ── Inline SVG Icons ── */

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
    >
      <path
        d="M4.5 2.5L8 6L4.5 9.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
      {open ? (
        <path
          d="M2 4v7a1 1 0 001 1h8a1 1 0 001-1V5a1 1 0 00-1-1H7L5.5 3H3a1 1 0 00-1 1z"
          stroke="currentColor"
          strokeWidth="1.2"
          fill="currentColor"
          fillOpacity="0.15"
        />
      ) : (
        <path
          d="M2 4v7a1 1 0 001 1h8a1 1 0 001-1V5a1 1 0 00-1-1H7L5.5 3H3a1 1 0 00-1 1z"
          stroke="currentColor"
          strokeWidth="1.2"
        />
      )}
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
      <path
        d="M3.5 1.5h4.5l3 3v8a1 1 0 01-1 1H3.5a1 1 0 01-1-1v-10a1 1 0 011-1z"
        stroke="#9aa3ad"
        strokeWidth="1.2"
        fill="#9aa3ad"
        fillOpacity="0.1"
      />
      <path d="M8 1.5v3h3" stroke="#9aa3ad" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

function ConflictDotIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="shrink-0">
      <circle cx="4" cy="4" r="3" fill="#f87171" />
    </svg>
  );
}

/* ── Tree Node ── */

function TreeNode({
  entry,
  depth,
  onFileClick,
  conflictPaths,
  hasConflictsDescendant,
}: {
  entry: FileEntry;
  depth: number;
  onFileClick?: (path: string) => void;
  conflictPaths?: Set<string>;
  hasConflictsDescendant: boolean;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const isDir = entry.isDirectory;
  const name = fileNameFromPath(entry.path);
  const isConflict = conflictPaths?.has(entry.path) ?? false;
  const paddingLeft = 4 + depth * 4;

  const handleClick = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      if (isDir) {
        setExpanded((v) => !v);
      } else {
        onFileClick?.(entry.path);
      }
    },
    [isDir, onFileClick, entry.path],
  );

  return (
    <div>
      {/* Node row */}
      <div
        className={`flex min-h-[32px] cursor-pointer select-none items-center gap-1 py-0.5 pr-2 text-[13px] transition-colors hover:bg-[rgba(255,255,255,0.04)] active:bg-[rgba(255,255,255,0.06)] ${
          isConflict
            ? 'bg-red-500/20 text-red-400'
            : 'text-[#f0f0f0]'
        }`}
        style={{ paddingLeft: `${paddingLeft}px` }}
        onClick={handleClick}
        role="treeitem"
        tabIndex={0}
        data-path={entry.path}
        data-testid={`harness-node-${name}`}
      >
        {/* Chevron (directories only) */}
        {isDir ? (
          <ChevronIcon open={expanded} />
        ) : (
          <span className="w-3 shrink-0" />
        )}

        {/* Icon */}
        {isDir ? (
          <FolderIcon open={expanded} />
        ) : (
          <FileIcon />
        )}

        {/* Conflict dot */}
        {isConflict && <ConflictDotIcon />}
        {!isConflict && hasConflictsDescendant && isDir && (
          <ConflictDotIcon />
        )}

        {/* Name — JetBrains Mono for files, Inter for dirs */}
        <span
          className={`min-w-0 flex-1 truncate ${
            isDir
              ? 'font-[\'Inter\'] font-medium text-[#f0f0f0]'
              : 'font-[\'JetBrains_Mono\'] text-[#ccd]'
          }`}
        >
          {name}
        </span>

        {/* Size (files only) */}
        {!isDir && entry.size > 0 && (
          <span className="ml-auto shrink-0 font-['JetBrains_Mono'] text-[10px] text-[#5a626c]">
            {formatSize(entry.size)}
          </span>
        )}
      </div>

      {/* Children (directories only) */}
      {isDir && expanded && entry.children && entry.children.length > 0 && (
        <div role="group">
          {entry.children.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              onFileClick={onFileClick}
              conflictPaths={conflictPaths}
              hasConflictsDescendant={hasDescendantConflict(child, conflictPaths)}
            />
          ))}
        </div>
      )}

      {/* Empty folder indicator */}
      {isDir && expanded && (!entry.children || entry.children.length === 0) && (
        <div
          className="py-1 text-[11px] text-[#5a626c]"
          style={{ paddingLeft: `${paddingLeft + 28}px` }}
        >
          Empty
        </div>
      )}
    </div>
  );
}

/**
 * Recursively check if a FileEntry (or any of its descendants) is in the
 * conflict set. Used to show a conflict indicator on parent directories
 * even when the directory itself is not conflicted.
 */
function hasDescendantConflict(
  entry: FileEntry,
  conflictPaths?: Set<string>,
): boolean {
  if (!conflictPaths || conflictPaths.size === 0) return false;
  if (conflictPaths.has(entry.path)) return true;
  if (entry.children) {
    return entry.children.some((child) => hasDescendantConflict(child, conflictPaths));
  }
  return false;
}

/* ── Empty State ── */

function EmptyState() {
  return (
    <div
      className="flex flex-col items-center justify-center py-12 text-center"
      data-testid="harness-tree-empty"
    >
      <svg
        width="32"
        height="32"
        viewBox="0 0 32 32"
        fill="none"
        className="mb-3 text-[#5a626c]"
      >
        <path
          d="M6 8h20v18a2 2 0 01-2 2H8a2 2 0 01-2-2V8z"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M6 8V6a2 2 0 012-2h8l4 4h6a2 2 0 012 2v2"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>
      <p className="text-[13px] text-[#5a626c]">No files</p>
    </div>
  );
}

/* ── Main Component ── */

/**
 * HarnessFileTree — a recursive file tree for displaying harness file listings.
 *
 * Renders a tree of `FileEntry` objects (pre-structured with `children` for
 * directories). Supports file click callbacks and conflict-path highlighting.
 */
export default function HarnessFileTree({
  files,
  onFileClick,
  conflictPaths,
}: HarnessFileTreeProps) {
  if (!files || files.length === 0) {
    return <EmptyState />;
  }

  return (
    <div
      className="h-full overflow-y-auto bg-[#0a0a0f] py-1"
      role="tree"
      data-testid="harness-file-tree"
    >
      {files.map((entry) => (
        <TreeNode
          key={entry.path}
          entry={entry}
          depth={0}
          onFileClick={onFileClick}
          conflictPaths={conflictPaths}
          hasConflictsDescendant={hasDescendantConflict(entry, conflictPaths)}
        />
      ))}
    </div>
  );
}
