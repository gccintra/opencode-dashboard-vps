import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  forwardRef,
  useImperativeHandle,
  type KeyboardEvent,
  type DragEvent,
} from 'react';
import { apiFetch, getToken, type ApiError } from '../../lib/api';
import { useGlobalClipboard } from '../../context/FileClipboardContext';

/* ── Types ── */

export interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt: string;
}

export interface FileContent {
  content: string;
  size: number;
  encoding: string;
  modifiedAt: string;
}

export interface FileTreeHandle {
  refresh: () => void;
}

export interface ClipboardState {
  sourcePath: string;
  projectId: string;
  action: 'copy';
}

interface TreeNode {
  entry: FileEntry;
  children: TreeNode[] | null; // null = not loaded, [] = empty
  loading: boolean;
}

/* ── Inline SVG Icons ── */

function FolderIcon({ open = false }: { open?: boolean }) {
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

function FileIcon({ extension }: { extension: string }) {
  const color =
    (
      {
        ts: '#3178c6',
        tsx: '#3178c6',
        js: '#f0db4f',
        jsx: '#f0db4f',
        json: '#f0db4f',
        md: '#af0',
        css: '#42a5f5',
        html: '#e65100',
        svg: '#ff9800',
        yml: '#7c4dff',
        yaml: '#7c4dff',
        gitignore: '#889',
      } as Record<string, string>
    )[extension] || '#889';

  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
      <path
        d="M3.5 1.5h4.5l3 3v8a1 1 0 01-1 1H3.5a1 1 0 01-1-1v-10a1 1 0 011-1z"
        stroke={color}
        strokeWidth="1.2"
        fill={color}
        fillOpacity="0.1"
      />
      <path d="M8 1.5v3h3" stroke={color} strokeWidth="1.2" fill="none" />
    </svg>
  );
}

function ChevronRightIcon({ open = false }: { open?: boolean }) {
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

function Spinner() {
  return (
    <div className="h-3 w-3 animate-spin rounded-full border border-[#af0] border-t-transparent" />
  );
}

function BreadcrumbIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
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

/* ── Context Menu ── */

interface ContextMenuState {
  x: number;
  y: number;
  path: string;
  isDir: boolean;
}

function ContextMenu({
  state,
  onClose,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  onUpload,
  onDownload,
  onCopy,
  onCut,
  onPaste,
  hasClipboard,
  isMobile: _isMobile,
}: {
  state: ContextMenuState;
  onClose: () => void;
  onNewFile: (parentPath: string) => void;
  onNewFolder: (parentPath: string) => void;
  onRename: (path: string) => void;
  onDelete: (path: string, isDir: boolean) => void;
  onUpload: (path: string) => void;
  onDownload: (path: string) => void;
  onCopy?: (path: string) => void;
  onCut?: (path: string) => void;
  onPaste?: (targetDir: string) => void;
  hasClipboard?: boolean;
  isMobile: boolean;
}) {
  const parentPath = state.isDir
    ? state.path
    : state.path.substring(0, state.path.lastIndexOf('/'));

  useEffect(() => {
    const handler = () => onClose();
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [onClose]);

  const items = [
    { label: 'New File', action: () => onNewFile(state.isDir ? state.path : parentPath || '') },
    { label: 'New Folder', action: () => onNewFolder(state.isDir ? state.path : parentPath || '') },
    onCopy ? { label: 'Copy', action: () => onCopy!(state.path) } : null,
    onCut ? { label: 'Cut', action: () => onCut!(state.path) } : null,
    state.isDir && hasClipboard && onPaste
      ? { label: 'Paste', action: () => onPaste!(state.path) }
      : null,
    { label: 'Rename', action: () => onRename(state.path) },
    { label: 'Delete', action: () => onDelete(state.path, state.isDir), danger: true },
    state.isDir ? { label: 'Upload File', action: () => onUpload(state.path) } : null,
    !state.isDir ? { label: 'Download', action: () => onDownload(state.path) } : null,
  ].filter(Boolean) as { label: string; action: () => void; danger?: boolean }[];

  // Clamp to viewport so the menu never escapes on narrow screens
  const MENU_W = 164;
  const MENU_H = items.length * 36 + 8;
  const clampedX = Math.min(
    state.x,
    (typeof window !== 'undefined' ? window.innerWidth : 400) - MENU_W - 8,
  );
  const clampedY = Math.min(
    state.y,
    (typeof window !== 'undefined' ? window.innerHeight : 800) - MENU_H - 8,
  );

  return (
    <div
      className="fixed z-50 min-w-[164px] rounded-[6px] border border-[rgba(255,255,255,0.08)] bg-[#14141e] py-1 shadow-xl"
      style={{ left: Math.max(4, clampedX), top: Math.max(4, clampedY) }}
      data-testid="context-menu"
    >
      {items.map((item) => (
        <button
          key={item.label}
          onClick={(e) => {
            e.stopPropagation();
            item.action();
            onClose();
          }}
          className={`block w-full px-3 py-2.5 text-left font-['Inter'] text-[13px] hover:bg-[rgba(255,255,255,0.06)] active:bg-[rgba(255,255,255,0.08)] transition-colors ${item.danger ? 'text-red-400' : 'text-[#ccd]'}`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/* ── Create Modal ── */

function CreateModal({
  type,
  parentPath: _parentPath,
  onConfirm,
  onCancel,
}: {
  type: 'file' | 'directory';
  parentPath: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (trimmed && !trimmed.includes('/')) {
      onConfirm(trimmed);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
      data-testid="create-modal"
    >
      <div
        className="w-[280px] rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[#111118] p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 font-['Inter'] text-[13px] font-medium text-[#f0f0f0]">
          New {type === 'directory' ? 'Folder' : 'File'}
        </h3>
        <input
          ref={inputRef}
          type="text"
          value={value}
          placeholder={type === 'directory' ? 'folder-name' : 'file.ts'}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit();
            if (e.key === 'Escape') onCancel();
          }}
          className="mb-3 w-full rounded-[4px] border border-[rgba(255,255,255,0.1)] bg-[#0a0a0f] px-3 py-1.5 font-['JetBrains_Mono'] text-[13px] text-[#f0f0f0] outline-none"
          data-testid="create-input"
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-[4px] px-3 py-1 font-['Inter'] text-[12px] text-[#889] hover:text-[#ccd]"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!value.trim() || value.trim().includes('/')}
            className="rounded-[4px] bg-[#af0] px-3 py-1 font-['Inter'] text-[12px] font-medium text-[#0a0a0f] disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Delete Modal ── */

function DeleteModal({
  name,
  isDir,
  onConfirm,
  onCancel,
}: {
  name: string;
  isDir: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
      data-testid="delete-modal"
    >
      <div
        className="w-[300px] rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[#111118] p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-2 font-['Inter'] text-[13px] font-medium text-[#f0f0f0]">
          Confirm Delete
        </h3>
        <p className="mb-4 font-['Inter'] text-[13px] text-[#889]">
          Delete {isDir ? 'folder' : 'file'}{' '}
          <span className="text-[#f0f0f0] font-mono">{name}</span>?
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-[4px] px-3 py-1 font-['Inter'] text-[12px] text-[#889] hover:text-[#ccd]"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-[4px] bg-red-500/20 border border-red-500/30 px-3 py-1 font-['Inter'] text-[12px] font-medium text-red-400 hover:bg-red-500/30"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── File Size Warning ── */

function LargeFileWarning({
  size,
  onContinue,
  onCancel,
}: {
  size: number;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const sizeKB = Math.round(size / 1024);
  const sizeMB = (size / (1024 * 1024)).toFixed(1);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
    >
      <div
        className="w-[320px] rounded-[8px] border border-yellow-500/30 bg-[#111118] p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-2 font-['Inter'] text-[13px] font-medium text-yellow-400">
          Large File Warning
        </h3>
        <p className="mb-4 font-['Inter'] text-[13px] text-[#889]">
          This file is {sizeKB > 1024 ? `${sizeMB} MB` : `${sizeKB} KB`}. It may be slow to edit.
          Open anyway?
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-[4px] px-3 py-1 font-['Inter'] text-[12px] text-[#889] hover:text-[#ccd]"
          >
            Cancel
          </button>
          <button
            onClick={onContinue}
            className="rounded-[4px] bg-yellow-500/20 border border-yellow-500/30 px-3 py-1 font-['Inter'] text-[12px] font-medium text-yellow-400"
          >
            Open
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Folder upload: recursively flatten FileSystemEntry tree into upload tasks ── */

async function collectEntriesFlat(
  entry: FileSystemEntry,
  prefix: string,
): Promise<Array<{ file: File; subPath: string }>> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) =>
      (entry as FileSystemFileEntry).file(res, rej),
    );
    return [{ file, subPath: prefix }];
  }
  const dirEntry = entry as FileSystemDirectoryEntry;
  const subPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
  const reader = dirEntry.createReader();
  const allEntries: FileSystemEntry[] = [];
  await new Promise<void>((res) => {
    const readBatch = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) { res(); return; }
        allEntries.push(...batch);
        readBatch();
      });
    readBatch();
  });
  const results: Array<{ file: File; subPath: string }> = [];
  for (const child of allEntries) {
    results.push(...(await collectEntriesFlat(child, subPrefix)));
  }
  return results;
}

/* ── Tree Node ── */

function TreeNodeItem({
  node,
  path,
  depth,
  projectId,
  onFileOpen,
  onRename,
  onDelete,
  onContextMenu,
  renamingPath,
  renameValue,
  onRenameChange,
  onRenameConfirm,
  isMobile,
  selectedPath,
  onSelect,
  draggingPath,
  dragOverPath,
  onDragStart,
  onDragOver,
  onDragDrop,
  onDragEnd,
  onUploadToDir,
  onDropEntries,
}: {
  node: TreeNode;
  path: string;
  depth: number;
  projectId: string;
  onFileOpen: (filePath: string) => void;
  onRename: (path: string) => void;
  onDelete: (path: string, isDir: boolean) => void;
  onContextMenu: (e: React.MouseEvent, ctxPath: string, isDir: boolean) => void;
  renamingPath: string | null;
  renameValue: string;
  onRenameChange: (v: string) => void;
  onRenameConfirm: (path: string, newName: string) => void;
  isMobile: boolean;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  draggingPath: string | null;
  dragOverPath: string | null;
  onDragStart: (path: string) => void;
  onDragOver: (path: string) => void;
  onDragDrop: (targetDir: string) => void;
  onDragEnd: () => void;
  onUploadToDir: (targetDir: string, files: FileList) => void;
  onDropEntries: (targetDir: string, entries: FileSystemEntry[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isDir = node.entry.type === 'directory';
  const fullPath = path ? `${path}/${node.entry.name}` : node.entry.name;
  const isRenaming = renamingPath === fullPath;
  const isSelected = selectedPath === fullPath;
  const isDragOver = dragOverPath === fullPath && draggingPath !== fullPath;
  const ext = node.entry.name.includes('.')
    ? node.entry.name.substring(node.entry.name.lastIndexOf('.'))
    : '';
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      longPressTimer.current = setTimeout(() => {
        onContextMenu(
          {
            clientX: touch.clientX,
            clientY: touch.clientY,
            preventDefault: () => {},
          } as React.MouseEvent,
          fullPath,
          isDir,
        );
      }, 500);
    },
    [fullPath, isDir, onContextMenu],
  );

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleExpand = useCallback(async () => {
    if (node.children !== null) {
      setExpanded(!expanded);
      return;
    }
    if (node.loading) return;
    setExpanded(true);
    const event = new CustomEvent('filetree:expand', { detail: { path: fullPath, node } });
    window.dispatchEvent(event);
  }, [expanded, node, fullPath]);

  const handleDoubleClick = useCallback(() => {
    if (!isDir) onFileOpen(fullPath);
    else handleExpand();
  }, [isDir, onFileOpen, fullPath, handleExpand]);

  // Drag-to-move handlers
  const handleDragStartNode = useCallback(
    (e: React.DragEvent) => {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', fullPath);
      onDragStart(fullPath);
    },
    [fullPath, onDragStart],
  );

  const handleDragOverNode = useCallback(
    (e: React.DragEvent) => {
      if (!isDir || draggingPath === fullPath) return;
      // Don't allow dropping into a child of itself
      if (draggingPath && fullPath.startsWith(draggingPath + '/')) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      onDragOver(fullPath);
    },
    [isDir, fullPath, draggingPath, onDragOver],
  );

  const handleDropNode = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (draggingPath && draggingPath !== fullPath) {
        if (isDir) onDragDrop(fullPath);
      } else if (isDir) {
        // Collect FileSystemEntry refs synchronously (they expire after event)
        const entries: FileSystemEntry[] = [];
        for (let i = 0; i < e.dataTransfer.items.length; i++) {
          const entry = e.dataTransfer.items[i].webkitGetAsEntry?.();
          if (entry) entries.push(entry);
        }
        if (entries.length > 0) onDropEntries(fullPath, entries);
      }
      onDragEnd();
    },
    [isDir, draggingPath, fullPath, onDragDrop, onDragEnd, onDropEntries],
  );

  // Indentation: 8px base + 16px per depth level (consistent at all levels)
  const paddingLeft = 8 + depth * 16;

  return (
    <div>
      <div
        className={`flex min-h-[32px] items-center gap-1 cursor-pointer select-none py-0.5 pr-2 font-['Inter'] text-[13px] transition-colors ${
          isSelected
            ? 'bg-[rgba(170,255,0,0.08)] text-[#f0f0f0]'
            : isDragOver
              ? 'bg-[rgba(170,255,0,0.12)]'
              : 'hover:bg-[rgba(255,255,255,0.04)] active:bg-[rgba(255,255,255,0.06)]'
        } ${draggingPath === fullPath ? 'opacity-40' : ''}`}
        style={{ paddingLeft }}
        draggable={!isRenaming}
        onDragStart={handleDragStartNode}
        onDragOver={handleDragOverNode}
        onDrop={handleDropNode}
        onDragEnd={onDragEnd}
        onClick={() => {
          onSelect(fullPath);
          if (isDir) handleExpand();
          else onFileOpen(fullPath);
        }}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(e, fullPath, isDir);
        }}
        onTouchStart={isMobile ? handleTouchStart : undefined}
        onTouchEnd={isMobile ? handleTouchEnd : undefined}
        onTouchMove={isMobile ? handleTouchEnd : undefined}
        data-testid={`tree-node-${node.entry.name}`}
        role="treeitem"
        tabIndex={0}
        data-path={fullPath}
        data-type={node.entry.type}
      >
        {isDir && (node.loading ? <Spinner /> : <ChevronRightIcon open={expanded} />)}
        {isDir ? (
          <FolderIcon open={expanded && node.children !== null} />
        ) : (
          <FileIcon extension={ext} />
        )}
        {isRenaming ? (
          <input
            type="text"
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameConfirm(fullPath, renameValue);
              if (e.key === 'Escape') onRenameConfirm(fullPath, node.entry.name);
            }}
            onBlur={() => onRenameConfirm(fullPath, renameValue)}
            className="flex-1 rounded-[3px] border border-[rgba(255,255,255,0.15)] bg-[#0a0a0f] px-1 py-px font-['Inter'] text-[13px] text-[#f0f0f0] outline-none"
            data-testid="rename-input"
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="truncate text-[#ccd]">{node.entry.name}</span>
        )}
        {!isDir && !isRenaming && node.entry.size > 0 && (
          <span className="ml-auto shrink-0 font-['JetBrains_Mono'] text-[10px] text-[#556]">
            {node.entry.size < 1024
              ? `${node.entry.size}B`
              : node.entry.size < 1048576
                ? `${Math.round(node.entry.size / 1024)}KB`
                : `${(node.entry.size / 1048576).toFixed(1)}MB`}
          </span>
        )}
      </div>
      {isDir && expanded && node.children !== null && (
        <div>
          {node.children.length === 0 && (
            <div
              className="py-1 font-['Inter'] text-[11px] text-[#556]"
              style={{ paddingLeft: paddingLeft + 32 }}
            >
              Empty
            </div>
          )}
          {node.children.map((child) => (
            <TreeNodeItem
              key={child.entry.name}
              node={child}
              path={fullPath}
              depth={depth + 1}
              projectId={projectId}
              onFileOpen={onFileOpen}
              onRename={onRename}
              onDelete={onDelete}
              onContextMenu={onContextMenu}
              renamingPath={renamingPath}
              renameValue={renameValue}
              onRenameChange={onRenameChange}
              onRenameConfirm={onRenameConfirm}
              isMobile={isMobile}
              selectedPath={selectedPath}
              onSelect={onSelect}
              draggingPath={draggingPath}
              dragOverPath={dragOverPath}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragDrop={onDragDrop}
              onDragEnd={onDragEnd}
              onUploadToDir={onUploadToDir}
              onDropEntries={onDropEntries}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Breadcrumb ── */

function Breadcrumb({
  currentPath,
  onNavigate,
}: {
  currentPath: string;
  onNavigate: (path: string) => void;
}) {
  const parts = currentPath ? currentPath.split('/') : [];
  return (
    <div
      className="flex items-center gap-1 overflow-x-auto py-2 font-['Inter'] text-[12px]"
      data-testid="breadcrumb"
    >
      <button
        onClick={() => onNavigate('')}
        className={`shrink-0 hover:text-[#f0f0f0] transition-colors ${currentPath === '' ? 'text-[#af0]' : 'text-[#889]'}`}
      >
        root
      </button>
      {parts.map((part, i) => (
        <span key={i} className="flex items-center gap-1 shrink-0">
          <BreadcrumbIcon />
          <button
            onClick={() => onNavigate(parts.slice(0, i + 1).join('/'))}
            className={`hover:text-[#f0f0f0] transition-colors ${i === parts.length - 1 ? 'text-[#af0]' : 'text-[#889]'}`}
          >
            {part}
          </button>
        </span>
      ))}
    </div>
  );
}

/* ── Search Bar ── */

function SearchBar({
  value,
  onChange,
  results,
  onSelect,
  onClose,
}: {
  value: string;
  onChange: (v: string) => void;
  results: { name: string; path: string; type: 'file' | 'directory' }[];
  onSelect: (path: string, type: 'file' | 'directory') => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="relative" data-testid="search-bar">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
        placeholder="Search files... (Ctrl+P)"
        className="w-full rounded-[4px] border border-[rgba(255,255,255,0.1)] bg-[#0a0a0f] px-3 py-1.5 font-['Inter'] text-[13px] text-[#f0f0f0] outline-none focus:border-[rgba(255,255,255,0.2)]"
        data-testid="search-input"
      />
      {results.length > 0 && (
        <div
          className="absolute left-0 right-0 top-full z-40 mt-1 max-h-[200px] overflow-y-auto rounded-[4px] border border-[rgba(255,255,255,0.08)] bg-[#14141e] py-1 shadow-xl"
          data-testid="search-results"
        >
          {results.map((r) => (
            <button
              key={r.path}
              onClick={() => onSelect(r.path, r.type)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[rgba(255,255,255,0.06)]"
            >
              {r.type === 'directory' ? (
                <FolderIcon />
              ) : (
                <FileIcon
                  extension={r.name.includes('.') ? r.name.substring(r.name.lastIndexOf('.')) : ''}
                />
              )}
              <span className="font-['Inter'] text-[12px] text-[#ccd]">{r.name}</span>
              <span className="ml-auto font-['JetBrains_Mono'] text-[10px] text-[#556] truncate">
                {r.path}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Upload Progress ── */

function UploadProgress({ progress, label }: { progress: number; label: string }) {
  if (progress >= 100 || progress <= 0) return null;
  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-[220px] rounded-[6px] border border-[rgba(255,255,255,0.08)] bg-[#111118] p-3"
      data-testid="upload-progress"
    >
      <div className="mb-1 flex items-center justify-between font-['Inter'] text-[11px] text-[#889]">
        <span>Uploading{label ? '...' : '...'}</span>
        {label && <span className="text-[#af0]">{label}</span>}
      </div>
      <div className="h-1 rounded-full bg-[rgba(255,255,255,0.08)] overflow-hidden">
        <div
          className="h-full rounded-full bg-[#af0] transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

/* ── Binary extension check ── */

const BINARY_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.ico',
  '.webp',
  '.avif',
  '.pdf',
  '.zip',
  '.gz',
  '.tar',
  '.7z',
  '.rar',
  '.exe',
  '.dll',
  '.so',
  '.bin',
  '.db',
  '.sqlite',
  '.mp3',
  '.mp4',
  '.avi',
  '.mov',
  '.mkv',
  '.wav',
  '.flac',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.eot',
  '.wasm',
  '.class',
  '.pyc',
]);

function isBinaryExt(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot >= 0 && BINARY_EXTS.has(name.substring(dot).toLowerCase());
}

/* ── Main FileTree Component ── */

export interface FileTreeProps {
  projectId: string;
  filesApiBase?: string;
  onFileOpen: (projectId: string, filePath: string) => void;
  isMobile?: boolean;
  onBack?: () => void;
  onCopy?: (path: string) => void;
  onPaste?: (targetDir: string) => void;
  clipboard?: ClipboardState | null;
}

const FileTree = forwardRef<FileTreeHandle, FileTreeProps>(function FileTree(
  { projectId, filesApiBase, onFileOpen, isMobile = false, onBack, onCopy: _onCopy, onPaste: _onPaste, clipboard: _clipboard },
  ref,
) {
  const base = filesApiBase ?? `/api/projects/${projectId}/files`;
  const {
    clipboard: globalClipboard,
    setCopy,
    setCut,
    paste: globalPaste,
  } = useGlobalClipboard();
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [showCreate, setShowCreate] = useState<{
    type: 'file' | 'directory';
    parentPath: string;
  } | null>(null);
  const [showDelete, setShowDelete] = useState<{
    path: string;
    name: string;
    isDir: boolean;
  } | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadLabel, setUploadLabel] = useState('');
  const [searchValue, setSearchValue] = useState('');
  const [largeFileWarning, setLargeFileWarning] = useState<{ path: string; size: number } | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const uploadMenuRef = useRef<HTMLDivElement>(null);
  const [uploadTargetDir, setUploadTargetDir] = useState('');
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  // Trash: text files store content in memory; binary files renamed to .trash/ on disk
  interface TrashItem {
    name: string;
    originalPath: string;
    deletedAt: Date;
    content?: string; // text files only
    movedToTrash?: boolean; // binary: renamed to .trash/{name} on disk
  }
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  // Selected path (for Ctrl+C/V keyboard shortcuts)
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  // Drag-to-move state
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);

  /* ── Fetch directory ── */
  const fetchDir = useCallback(
    async (dirPath: string): Promise<TreeNode[]> => {
      const entries = await apiFetch<FileEntry[]>(
        `${base}?path=${encodeURIComponent(dirPath)}`,
      );
      return entries.map((e) => ({
        entry: e,
        children: e.type === 'directory' ? null : null,
        loading: false,
      }));
    },
    [base, projectId],
  );

  const loadRoot = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nodes = await fetchDir('');
      setTree(nodes);
    } catch (err) {
      setError((err as ApiError).message || 'Failed to load files');
    } finally {
      setLoading(false);
    }
  }, [fetchDir]);

  useEffect(() => {
    loadRoot();
  }, [loadRoot]);

  useImperativeHandle(ref, () => ({ refresh: loadRoot }), [loadRoot]);

  /* ── Global clipboard handlers ── */
  const handleContextCopy = useCallback(
    (path: string) => {
      const name = path.split('/').pop() || path;
      setCopy(name, path, base);
    },
    [base, setCopy],
  );

  const handleContextCut = useCallback(
    (path: string) => {
      const name = path.split('/').pop() || path;
      setCut(name, path, base);
    },
    [base, setCut],
  );

  const handleContextPaste = useCallback(
    async (destDir: string) => {
      const result = await globalPaste(base, destDir);
      if (!result.ok && result.error) setError(result.error);
      else await loadRoot();
    },
    [base, globalPaste, loadRoot],
  );

  /* ── Move file via drag-drop ── */
  const handleMoveFile = useCallback(
    async (srcPath: string, destDir: string) => {
      const name = srcPath.split('/').pop() || srcPath;
      const newPath = destDir ? `${destDir}/${name}` : name;
      if (newPath === srcPath) return;
      try {
        await apiFetch(`${base}/rename`, {
          method: 'PUT',
          body: JSON.stringify({ oldPath: srcPath, newPath }),
        });
        await loadRoot();
      } catch (err) {
        setError((err as ApiError).message || 'Move failed');
      }
    },
    [projectId, loadRoot],
  );

  /* ── Ctrl+C / Ctrl+V on selected file ── */
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      // Only trigger when focus is inside the tree (not in an input/textarea)
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'c' && selectedPath) {
        e.preventDefault();
        handleContextCopy(selectedPath);
      } else if (e.key === 'v' && globalClipboard) {
        e.preventDefault();
        // Paste into selected dir, or parent dir of selected file, or root
        const targetDir = selectedPath
          ? selectedPath.includes('/')
            ? selectedPath.substring(0, selectedPath.lastIndexOf('/'))
            : ''
          : '';
        void handleContextPaste(targetDir);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedPath, globalClipboard, handleContextCopy, handleContextPaste]);

  /* ── Lazy expand ── */
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail as { path: string; node: TreeNode };
      detail.node.loading = true;
      setTree([...tree]);
      try {
        const children = await fetchDir(detail.path);
        detail.node.children = children;
        detail.node.loading = false;
        setTree([...tree]);
      } catch {
        detail.node.loading = false;
        setTree([...tree]);
      }
    };
    window.addEventListener('filetree:expand', handler);
    return () => window.removeEventListener('filetree:expand', handler);
  }, [tree, fetchDir]);

  /* ── Close upload menu on outside click ── */
  useEffect(() => {
    if (!uploadMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (uploadMenuRef.current && !uploadMenuRef.current.contains(e.target as Node)) {
        setUploadMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [uploadMenuOpen]);

  /* ── File open ── */
  const handleFileOpen = useCallback(
    async (filePath: string) => {
      try {
        const listing = await apiFetch<FileEntry[]>(
          `${base}?path=${encodeURIComponent(filePath.substring(0, filePath.lastIndexOf('/')))}`,
        );
        const file = listing.find((f: FileEntry) => f.name === filePath.split('/').pop());
        if (file && file.size > 500 * 1024) {
          setLargeFileWarning({ path: filePath, size: file.size });
          return;
        }
      } catch {
        // If listing fails, proceed anyway
      }
      onFileOpen(projectId, filePath);
    },
    [projectId, onFileOpen],
  );

  /* ── Create Operations ── */
  const handleCreate = useCallback(
    async (type: 'file' | 'directory', parentPath: string, name: string) => {
      const p = parentPath ? `${parentPath}/${name}` : name;
      try {
        await apiFetch(`${base}`, {
          method: 'POST',
          body: JSON.stringify({ path: p, type }),
        });
        await loadRoot();
        setShowCreate(null);
      } catch (err) {
        setError((err as ApiError).message || 'Failed to create');
      }
    },
    [projectId, loadRoot],
  );

  /* ── Delete Operation — soft-delete text files to trash, hard-delete dirs & binaries ── */
  const handleDelete = useCallback(
    async (path: string, isDir: boolean) => {
      const name = path.split('/').pop() || path;
      if (!isDir && !isBinaryExt(name)) {
        // Text file: read content first so it can be restored from trash
        try {
          const data = await apiFetch<{ content: string }>(
            `${base}/read?path=${encodeURIComponent(path)}`,
          );
          await apiFetch(`${base}?path=${encodeURIComponent(path)}`, {
            method: 'DELETE',
          });
          setTrashItems((prev) => [
            { name, originalPath: path, content: data.content, deletedAt: new Date() },
            ...prev,
          ]);
        } catch (err) {
          setError((err as ApiError).message || 'Failed to delete');
          return;
        }
      } else if (!isDir) {
        // Binary file: rename to .trash/{name} so it can be restored
        const trashPath = `.trash/${name}`;
        try {
          // Ensure .trash/ exists (ignore 409 = already exists)
          await apiFetch(`${base}`, {
            method: 'POST',
            body: JSON.stringify({ path: '.trash', type: 'directory' }),
          }).catch(() => {});
          await apiFetch(`${base}/rename`, {
            method: 'PUT',
            body: JSON.stringify({ oldPath: path, newPath: trashPath }),
          });
          setTrashItems((prev) => [
            { name, originalPath: path, deletedAt: new Date(), movedToTrash: true },
            ...prev,
          ]);
        } catch (err) {
          setError((err as ApiError).message || 'Failed to delete');
          return;
        }
      } else {
        // Directory: hard-delete immediately
        try {
          await apiFetch(
            `${base}?path=${encodeURIComponent(path)}&force=true`,
            { method: 'DELETE' },
          );
        } catch (err) {
          setError((err as ApiError).message || 'Failed to delete');
          return;
        }
      }
      await loadRoot();
      setShowDelete(null);
    },
    [projectId, loadRoot],
  );

  /* ── Restore from Trash ── */
  const handleRestore = useCallback(
    async (item: {
      name: string;
      originalPath: string;
      content?: string;
      movedToTrash?: boolean;
    }) => {
      try {
        if (item.movedToTrash) {
          // Binary: rename back from .trash/{name} to original path
          await apiFetch(`${base}/rename`, {
            method: 'PUT',
            body: JSON.stringify({ oldPath: `.trash/${item.name}`, newPath: item.originalPath }),
          });
        } else {
          // Text: write stored content back to original path
          await apiFetch(
            `${base}/write?path=${encodeURIComponent(item.originalPath)}`,
            { method: 'PUT', body: JSON.stringify({ content: item.content ?? '' }) },
          );
        }
        setTrashItems((prev) => prev.filter((t) => t.originalPath !== item.originalPath));
        await loadRoot();
      } catch (err) {
        setError((err as ApiError).message || 'Restore failed');
      }
    },
    [projectId, loadRoot],
  );

  /* ── Rename Operation ── */
  const handleRename = useCallback(
    async (oldPath: string, newName: string) => {
      const parts = oldPath.split('/');
      parts[parts.length - 1] = newName;
      const newPath = parts.join('/');
      try {
        await apiFetch(`${base}/rename`, {
          method: 'PUT',
          body: JSON.stringify({ oldPath, newPath }),
        });
        await loadRoot();
        setRenamingPath(null);
      } catch (err) {
        setError((err as ApiError).message || 'Failed to rename');
      }
    },
    [projectId, loadRoot],
  );

  /* ── Batch upload (files + folders with preserved paths) ── */
  const handleBatchUpload = useCallback(
    async (baseDir: string, tasks: Array<{ file: File; subPath: string }>) => {
      const total = tasks.length;
      if (total === 0) return;
      const token = getToken();
      let done = 0;
      setUploadProgress(5);
      setUploadLabel(`0 / ${total}`);
      for (const { file, subPath } of tasks) {
        const targetDir = subPath
          ? baseDir ? `${baseDir}/${subPath}` : subPath
          : baseDir;
        const formData = new FormData();
        formData.append('file', file);
        try {
          const response = await fetch(`${base}/upload?path=${encodeURIComponent(targetDir)}`, {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: formData,
          });
          if (!response.ok) {
            const data = await response.json().catch(() => ({ error: 'Upload failed' }));
            const msg = (data as { error?: string }).error || 'Upload failed';
            if (!msg.includes('already exists')) setError(msg);
          }
        } catch (err) {
          setError((err as Error).message || 'Upload failed');
        }
        done++;
        setUploadLabel(`${done} / ${total}`);
        setUploadProgress(Math.round((done / total) * 90) + 5);
      }
      setUploadProgress(100);
      setTimeout(() => { setUploadProgress(0); setUploadLabel(''); }, 1000);
      await loadRoot();
    },
    [base, loadRoot],
  );

  const handleUpload = useCallback(
    (targetDir: string, file: File) => handleBatchUpload(targetDir, [{ file, subPath: '' }]),
    [handleBatchUpload],
  );

  /* ── Download ── */
  const handleDownload = useCallback(
    async (filePath: string) => {
      const token = getToken();
      try {
        const response = await fetch(
          `${base}/download?path=${encodeURIComponent(filePath)}`,
          {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          },
        );
        if (!response.ok) {
          const data = await response.json().catch(() => ({ error: 'Download failed' }));
          setError((data as { error?: string }).error || 'Download failed');
          return;
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const filename = filePath.split('/').pop() || 'download';
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        setError((err as Error).message || 'Download failed');
      }
    },
    [projectId],
  );

  /* ── Upload flat FileList to a specific dir (button-triggered) ── */
  const handleUploadToDir = useCallback(
    (targetDir: string, files: FileList) => {
      const tasks: Array<{ file: File; subPath: string }> = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        // webkitRelativePath is set when using <input webkitdirectory>
        const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
        if (rel) {
          const parts = rel.split('/');
          parts.shift(); // strip the top-level folder name
          const subPath = parts.slice(0, -1).join('/');
          tasks.push({ file: f, subPath });
        } else {
          tasks.push({ file: f, subPath: '' });
        }
      }
      return handleBatchUpload(targetDir, tasks);
    },
    [handleBatchUpload],
  );

  /* ── Upload from drop entries (files + folders via DataTransferItemList) ── */
  const handleDropEntries = useCallback(
    async (targetDir: string, entries: FileSystemEntry[]) => {
      const tasks: Array<{ file: File; subPath: string }> = [];
      for (const entry of entries) {
        tasks.push(...(await collectEntriesFlat(entry, '')));
      }
      await handleBatchUpload(targetDir, tasks);
    },
    [handleBatchUpload],
  );

  /* ── Drag & Drop on outer container (upload from OS OR internal drag-to-root) ── */
  const handleDrop = useCallback(
    async (e: DragEvent, targetDir: string) => {
      e.preventDefault();
      if (draggingPath) {
        handleMoveFile(draggingPath, targetDir);
        setDraggingPath(null);
        setDragOverPath(null);
      } else {
        // Collect entries synchronously before any await (DataTransfer clears after event)
        const entries: FileSystemEntry[] = [];
        const items = e.dataTransfer?.items;
        if (items) {
          for (let i = 0; i < items.length; i++) {
            const entry = items[i].webkitGetAsEntry?.();
            if (entry) entries.push(entry);
          }
        }
        if (entries.length > 0) {
          await handleDropEntries(targetDir, entries);
        }
      }
    },
    [draggingPath, handleDropEntries, handleMoveFile],
  );


  /* ── Inline search: filter visible loaded nodes ── */
  const visibleTree = useMemo(() => {
    const q = searchValue.trim().toLowerCase();
    if (!q) return tree;
    function filterNodes(nodes: TreeNode[]): TreeNode[] {
      return nodes.flatMap((n) => {
        const match = n.entry.name.toLowerCase().includes(q);
        if (n.entry.type === 'file') return match ? [n] : [];
        const filteredChildren = n.children ? filterNodes(n.children) : null;
        if (match) return [{ ...n, children: filteredChildren ?? [], loading: false }];
        if (filteredChildren && filteredChildren.length > 0)
          return [{ ...n, children: filteredChildren, loading: false }];
        return [];
      });
    }
    return filterNodes(tree);
  }, [tree, searchValue]);

  /* ── Context menu actions ── */
  const handleContextNewFile = useCallback((parentPath: string) => {
    setShowCreate({ type: 'file', parentPath });
  }, []);

  const handleContextNewFolder = useCallback((parentPath: string) => {
    setShowCreate({ type: 'directory', parentPath });
  }, []);

  const handleContextRename = useCallback((path: string) => {
    const name = path.split('/').pop() || '';
    setRenamingPath(path);
    setRenameValue(name);
  }, []);

  const handleContextDelete = useCallback((path: string, isDir: boolean) => {
    const name = path.split('/').pop() || '';
    setShowDelete({ path, name, isDir });
  }, []);

  const handleContextUpload = useCallback((path: string) => {
    setUploadTargetDir(path);
    fileInputRef.current?.click();
  }, []);

  /* ── Render ── */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8" data-testid="filetree-loading">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#af0] border-t-transparent" />
      </div>
    );
  }

  if (error && tree.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-8" data-testid="filetree-error">
        <p className="font-['Inter'] text-[13px] text-red-400">{error}</p>
        <button
          onClick={loadRoot}
          className="rounded-[4px] border border-[rgba(255,255,255,0.1)] px-3 py-1 font-['Inter'] text-[12px] text-[#ccd] hover:border-[rgba(255,255,255,0.2)]"
        >
          Retry
        </button>
      </div>
    );
  }

  const hasClipboard = !!globalClipboard;

  return (
    <div className="flex h-full flex-col" data-testid="filetree-container">
      {/* Clipboard indicator */}
      {globalClipboard && (
        <div className="flex min-h-[36px] items-center gap-2 border-b border-[rgba(255,255,255,0.06)] bg-[rgba(170,255,0,0.06)] px-3 py-1.5">
          <span className="min-w-0 flex-1 truncate font-['Inter'] text-[11px] text-[#af0]">
            {globalClipboard.fileName} {globalClipboard.action}
          </span>
          <span className="shrink-0 font-['Inter'] text-[10px] text-[#556]">
            {isMobile ? 'hold to paste' : 'right-click dir to paste'}
          </span>
        </div>
      )}

      {/* Header with search toggle & upload */}
      <div className="flex min-h-[40px] items-center gap-2 border-b border-[rgba(255,255,255,0.08)] px-3 py-1.5">
        {isMobile && onBack && (
          <button
            onClick={onBack}
            className="mr-1 font-['Inter'] text-[12px] text-[#889] active:text-[#ccd]"
          >
            Back
          </button>
        )}
        {/* Inline search — filters tree in place */}
        <input
          type="text"
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          placeholder="Filter files..."
          className="min-h-[30px] flex-1 rounded-[4px] border border-[rgba(255,255,255,0.08)] bg-transparent px-2 py-1 font-['Inter'] text-[12px] text-[#ccd] placeholder-[#445] outline-none focus:border-[rgba(255,255,255,0.2)]"
          data-testid="search-input"
        />
        {searchValue && (
          <button
            onClick={() => setSearchValue('')}
            className="shrink-0 px-1 font-['Inter'] text-[12px] text-[#556] hover:text-[#889]"
          >
            ×
          </button>
        )}
        {/* New file */}
        <button
          title="New file"
          onClick={() =>
            setShowCreate({
              type: 'file',
              parentPath: selectedPath
                ? selectedPath.includes('/')
                  ? selectedPath.substring(0, selectedPath.lastIndexOf('/'))
                  : ''
                : currentPath,
            })
          }
          className="flex min-h-[30px] w-[28px] shrink-0 items-center justify-center rounded-[4px] border border-[rgba(255,255,255,0.08)] text-[#889] hover:border-[rgba(255,255,255,0.2)] hover:text-[#af0]"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M2 1.5h5l2.5 2.5V10a.5.5 0 01-.5.5H2a.5.5 0 01-.5-.5V2a.5.5 0 01.5-.5z"
              stroke="currentColor"
              strokeWidth="1.1"
            />
            <path d="M5 6H7M6 5v2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          </svg>
        </button>
        {/* New folder */}
        <button
          title="New folder"
          onClick={() =>
            setShowCreate({
              type: 'directory',
              parentPath: selectedPath
                ? selectedPath.includes('/')
                  ? selectedPath.substring(0, selectedPath.lastIndexOf('/'))
                  : ''
                : currentPath,
            })
          }
          className="flex min-h-[30px] w-[28px] shrink-0 items-center justify-center rounded-[4px] border border-[rgba(255,255,255,0.08)] text-[#889] hover:border-[rgba(255,255,255,0.2)] hover:text-[#af0]"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M1.5 3v6a1 1 0 001 1h7a1 1 0 001-1V4.5A1 1 0 009.5 3.5H6.5L5.5 2.5H2.5a1 1 0 00-1 .5z"
              stroke="currentColor"
              strokeWidth="1.1"
            />
            <path
              d="M5 6.5H7M6 5.5v2"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinecap="round"
            />
          </svg>
        </button>
        {/* Hidden file inputs */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = e.target.files;
            if (files) handleUploadToDir(uploadTargetDir || currentPath, files);
            e.target.value = '';
          }}
          data-testid="file-upload-input"
        />
        <input
          ref={folderInputRef}
          type="file"
          // @ts-expect-error webkitdirectory is non-standard but widely supported
          webkitdirectory=""
          multiple
          className="hidden"
          onChange={(e) => {
            const files = e.target.files;
            if (files) handleUploadToDir(uploadTargetDir || currentPath, files);
            e.target.value = '';
          }}
          data-testid="folder-upload-input"
        />
        {/* Upload button — dropdown (desktop) + bottom sheet (mobile) */}
        <div ref={uploadMenuRef} className="relative shrink-0">
          <button
            title="Upload files or folder"
            onClick={() => {
              setUploadTargetDir(
                selectedPath && !selectedPath.includes('.') ? selectedPath : currentPath,
              );
              setUploadMenuOpen((v) => !v);
            }}
            className={`flex min-h-[30px] items-center gap-[5px] rounded-[4px] border px-[8px] font-['Inter'] text-[12px] font-medium transition-colors ${
              uploadMenuOpen
                ? 'border-[rgba(170,255,0,0.4)] bg-[rgba(170,255,0,0.08)] text-[#af0]'
                : 'border-[rgba(255,255,255,0.08)] text-[#889] hover:border-[rgba(255,255,255,0.2)] hover:text-[#ccd]'
            }`}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path
                d="M6 1.5v7M3.5 4L6 1.5 8.5 4"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M1.5 9.5v.5a1 1 0 001 1h7a1 1 0 001-1v-.5"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
            <span>Upload</span>
          </button>

          {/* Desktop dropdown */}
          {uploadMenuOpen && (
            <div className="absolute right-0 top-[calc(100%+4px)] z-50 hidden w-[168px] rounded-[8px] border border-[rgba(255,255,255,0.1)] bg-[#141420] py-1 shadow-xl sm:block">
              <button
                className="flex w-full items-center gap-[10px] px-[12px] py-[9px] font-['Inter'] text-[13px] text-[#ccd] hover:bg-[rgba(255,255,255,0.06)] transition-colors"
                onClick={() => { fileInputRef.current?.click(); setUploadMenuOpen(false); }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 2h5l3 3v7a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M8 2v3h3" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M7 6v4M5.5 8l1.5-2 1.5 2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Files
              </button>
              <button
                className="flex w-full items-center gap-[10px] px-[12px] py-[9px] font-['Inter'] text-[13px] text-[#ccd] hover:bg-[rgba(255,255,255,0.06)] transition-colors"
                onClick={() => { folderInputRef.current?.click(); setUploadMenuOpen(false); }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M1.5 4A1.5 1.5 0 013 2.5h3.172a1 1 0 01.707.293L8 4H12a1 1 0 011 1v6a1 1 0 01-1 1H2a1 1 0 01-1-1V5.5A1.5 1.5 0 011.5 4z" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M7 6.5v3M5.5 8L7 6.5 8.5 8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Folder
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="border-b border-[rgba(255,255,255,0.06)] px-3">
        <Breadcrumb currentPath={currentPath} onNavigate={setCurrentPath} />
      </div>

      {/* Tree — also an external drop zone for files/folders */}
      <div
        className={`flex-1 overflow-y-auto py-1 ${draggingPath ? 'outline-dashed outline-1 outline-[rgba(170,255,0,0.15)]' : ''}`}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = draggingPath ? 'move' : 'copy'; }}
        onDragEnter={(e) => e.preventDefault()}
        onDrop={(e) => handleDrop(e, currentPath)}
        role="tree"
        data-testid="file-tree"
      >
        {visibleTree.length === 0 && (
          <div
            className="px-3 py-4 text-center font-['Inter'] text-[13px] text-[#556]"
            data-testid="filetree-empty"
          >
            {searchValue ? 'No matches' : 'Empty project'}
          </div>
        )}
        {visibleTree.map((node) => (
          <TreeNodeItem
            key={node.entry.name}
            node={node}
            path=""
            depth={0}
            projectId={projectId}
            onFileOpen={handleFileOpen}
            onRename={handleContextRename}
            onDelete={handleContextDelete}
            onContextMenu={(e, p, isDir) =>
              setContextMenu({ x: e.clientX, y: e.clientY, path: p, isDir })
            }
            renamingPath={renamingPath}
            renameValue={renameValue}
            onRenameChange={setRenameValue}
            onRenameConfirm={handleRename}
            isMobile={isMobile}
            selectedPath={selectedPath}
            onSelect={setSelectedPath}
            draggingPath={draggingPath}
            dragOverPath={dragOverPath}
            onDragStart={setDraggingPath}
            onDragOver={setDragOverPath}
            onDragDrop={(destDir) => {
              if (draggingPath) handleMoveFile(draggingPath, destDir);
            }}
            onDragEnd={() => {
              setDraggingPath(null);
              setDragOverPath(null);
            }}
            onUploadToDir={handleUploadToDir}
            onDropEntries={handleDropEntries}
          />
        ))}
      </div>

      {/* Modals */}
      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          onNewFile={handleContextNewFile}
          onNewFolder={handleContextNewFolder}
          onRename={handleContextRename}
          onDelete={handleContextDelete}
          onUpload={handleContextUpload}
          onDownload={handleDownload}
          onCopy={handleContextCopy}
          onCut={handleContextCut}
          onPaste={handleContextPaste}
          hasClipboard={hasClipboard}
          isMobile={isMobile}
        />
      )}
      {showCreate && (
        <CreateModal
          type={showCreate.type}
          parentPath={showCreate.parentPath}
          onConfirm={(name) => handleCreate(showCreate.type, showCreate.parentPath, name)}
          onCancel={() => setShowCreate(null)}
        />
      )}
      {showDelete && (
        <DeleteModal
          name={showDelete.name}
          isDir={showDelete.isDir}
          onConfirm={() => handleDelete(showDelete.path, showDelete.isDir)}
          onCancel={() => setShowDelete(null)}
        />
      )}
      {largeFileWarning && (
        <LargeFileWarning
          size={largeFileWarning.size}
          onContinue={() => {
            const p = largeFileWarning.path;
            setLargeFileWarning(null);
            onFileOpen(projectId, p);
          }}
          onCancel={() => setLargeFileWarning(null)}
        />
      )}
      {/* Mobile upload bottom sheet */}
      {uploadMenuOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end sm:hidden"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => setUploadMenuOpen(false)}
        >
          <div
            className="rounded-t-[18px] border-t border-[rgba(255,255,255,0.08)] bg-[#111118] px-4 pb-8 pt-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Handle bar */}
            <div className="mx-auto mb-4 h-[4px] w-[36px] rounded-full bg-[rgba(255,255,255,0.12)]" />
            <p className="mb-3 text-center font-['Inter'] text-[12px] text-[#556]">Upload para</p>
            <p className="mb-4 text-center font-['Inter'] text-[13px] font-medium text-[#889] truncate">
              /{uploadTargetDir || 'root'}
            </p>
            <button
              className="mb-2 flex w-full items-center gap-3 rounded-[12px] bg-[rgba(255,255,255,0.05)] px-4 py-4 font-['Inter'] text-[15px] font-medium text-[#f0f0f0] active:bg-[rgba(255,255,255,0.1)] transition-colors"
              onClick={() => { fileInputRef.current?.click(); setUploadMenuOpen(false); }}
            >
              <div className="flex size-[38px] shrink-0 items-center justify-center rounded-[10px] bg-[rgba(170,255,0,0.1)]">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M4 3h7l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="#af0" strokeWidth="1.4" />
                  <path d="M11 3v4h4" stroke="#af0" strokeWidth="1.4" />
                  <path d="M9 8.5v5M6.5 11l2.5-2.5 2.5 2.5" stroke="#af0" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="text-left">
                <div className="font-semibold">Upload arquivos</div>
                <div className="mt-0.5 text-[12px] font-normal text-[#556]">Selecione um ou mais arquivos</div>
              </div>
            </button>
            <button
              className="mb-3 flex w-full items-center gap-3 rounded-[12px] bg-[rgba(255,255,255,0.05)] px-4 py-4 font-['Inter'] text-[15px] font-medium text-[#f0f0f0] active:bg-[rgba(255,255,255,0.1)] transition-colors"
              onClick={() => { folderInputRef.current?.click(); setUploadMenuOpen(false); }}
            >
              <div className="flex size-[38px] shrink-0 items-center justify-center rounded-[10px] bg-[rgba(170,255,0,0.1)]">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M2 5.5A2 2 0 014 3.5h4.172a1 1 0 01.707.293L10.5 5.5H15a1 1 0 011 1v7a1 1 0 01-1 1H3a1 1 0 01-1-1V5.5z" stroke="#af0" strokeWidth="1.4" />
                  <path d="M9 8v5M6.5 10.5L9 8l2.5 2.5" stroke="#af0" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="text-left">
                <div className="font-semibold">Upload pasta</div>
                <div className="mt-0.5 text-[12px] font-normal text-[#556]">Mantém a estrutura de diretórios</div>
              </div>
            </button>
            <button
              className="w-full rounded-[12px] py-3 font-['Inter'] text-[14px] text-[#556] active:text-[#889] transition-colors"
              onClick={() => setUploadMenuOpen(false)}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <UploadProgress progress={uploadProgress} label={uploadLabel} />

      {/* Trash section */}
      {trashItems.length > 0 && (
        <div className="shrink-0 border-t border-[rgba(255,255,255,0.06)]">
          <button
            onClick={() => setShowTrash((v) => !v)}
            className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-[rgba(255,255,255,0.02)]"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              className={`shrink-0 text-[#556] transition-transform ${showTrash ? 'rotate-90' : ''}`}
            >
              <path
                d="M3 1.5L7 5L3 8.5"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
            <svg
              width="11"
              height="11"
              viewBox="0 0 11 11"
              fill="none"
              className="shrink-0 text-[#556]"
            >
              <path
                d="M2 3h7M3.5 3V2a.5.5 0 01.5-.5h3a.5.5 0 01.5.5v1M4.5 5v3.5M6.5 5v3.5M2.5 3l.5 5.5a1 1 0 001 1h3a1 1 0 001-1L9 3"
                stroke="currentColor"
                strokeWidth="1"
              />
            </svg>
            <span className="font-['Inter'] text-[10px] text-[#556]">
              Trash ({trashItems.length})
            </span>
          </button>
          {showTrash && (
            <div className="max-h-[140px] overflow-y-auto border-t border-[rgba(255,255,255,0.04)]">
              {trashItems.map((item) => (
                <div
                  key={item.originalPath}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-[rgba(255,255,255,0.02)]"
                >
                  <span
                    className="min-w-0 flex-1 truncate font-['Inter'] text-[11px] text-[#889]"
                    title={item.originalPath}
                  >
                    {item.name}
                  </span>
                  <span className="shrink-0 font-['JetBrains_Mono'] text-[9px] text-[#445]">
                    {item.deletedAt.toLocaleTimeString()}
                  </span>
                  <button
                    onClick={() => handleRestore(item)}
                    className="shrink-0 rounded-[3px] border border-[rgba(255,255,255,0.08)] px-1.5 py-0.5 font-['Inter'] text-[10px] text-[#889] hover:border-[rgba(170,255,0,0.3)] hover:text-[#af0]"
                  >
                    Restore
                  </button>
                  <button
                    onClick={() =>
                      setTrashItems((prev) =>
                        prev.filter((t) => t.originalPath !== item.originalPath),
                      )
                    }
                    className="shrink-0 font-['Inter'] text-[10px] text-[#445] hover:text-red-400"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Error banner */}
      {error && tree.length > 0 && (
        <div
          className="border-t border-red-500/20 bg-red-500/10 px-3 py-1.5 font-['Inter'] text-[11px] text-red-400"
          data-testid="filetree-error-banner"
        >
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-[#889] hover:text-[#ccd]">
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
});

export default FileTree;
