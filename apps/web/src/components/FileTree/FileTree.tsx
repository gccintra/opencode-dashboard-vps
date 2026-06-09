import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type KeyboardEvent,
  type DragEvent,
} from 'react';
import { apiFetch, type ApiError } from '../../lib/api';

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
  isMobile: _isMobile,
}: {
  state: ContextMenuState;
  onClose: () => void;
  onNewFile: (parentPath: string) => void;
  onNewFolder: (parentPath: string) => void;
  onRename: (path: string) => void;
  onDelete: (path: string, isDir: boolean) => void;
  onUpload: (path: string) => void;
  isMobile: boolean;
}) {
  const parentPath = state.isDir
    ? state.path
    : state.path.substring(0, state.path.lastIndexOf('/'));

  // Close on outside click
  useEffect(() => {
    const handler = () => onClose();
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [onClose]);

  const items = [
    { label: 'New File', action: () => onNewFile(state.isDir ? state.path : parentPath || '') },
    { label: 'New Folder', action: () => onNewFolder(state.isDir ? state.path : parentPath || '') },
    { label: 'Rename', action: () => onRename(state.path) },
    { label: 'Delete', action: () => onDelete(state.path, state.isDir), danger: true },
    state.isDir ? { label: 'Upload File', action: () => onUpload(state.path) } : null,
  ].filter(Boolean) as { label: string; action: () => void; danger?: boolean }[];

  return (
    <div
      className="fixed z-50 min-w-[140px] rounded-[6px] border border-[rgba(255,255,255,0.08)] bg-[#14141e] py-1 shadow-xl"
      style={{ left: state.x, top: state.y }}
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
          className={`block w-full px-3 py-1.5 text-left font-['Inter'] text-[12px] hover:bg-[rgba(255,255,255,0.06)] transition-colors ${item.danger ? 'text-red-400' : 'text-[#ccd]'}`}
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
}) {
  const [expanded, setExpanded] = useState(false);
  const isDir = node.entry.type === 'directory';
  const fullPath = path ? `${path}/${node.entry.name}` : node.entry.name;
  const isRenaming = renamingPath === fullPath;
  const ext = node.entry.name.includes('.')
    ? node.entry.name.substring(node.entry.name.lastIndexOf('.'))
    : '';

  const handleExpand = useCallback(async () => {
    if (node.children !== null) {
      setExpanded(!expanded);
      return;
    }
    if (node.loading) return;

    setExpanded(true);
    // Trigger lazy load
    const event = new CustomEvent('filetree:expand', { detail: { path: fullPath, node } });
    window.dispatchEvent(event);
  }, [expanded, node, fullPath]);

  const handleDoubleClick = useCallback(() => {
    if (!isDir) {
      onFileOpen(fullPath);
    } else {
      handleExpand();
    }
  }, [isDir, onFileOpen, fullPath, handleExpand]);

  return (
    <div>
      <div
        className={`flex items-center gap-1 cursor-pointer select-none py-0.5 pr-2 font-['Inter'] text-[13px] hover:bg-[rgba(255,255,255,0.04)] transition-colors ${depth > 0 ? 'ml-3' : ''}`}
        style={{ paddingLeft: `${depth > 0 ? 12 : 8}px` }}
        onClick={() => (isDir ? handleExpand() : onFileOpen(fullPath))}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(e, fullPath, isDir);
        }}
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
              if (e.key === 'Escape') onRenameConfirm(fullPath, node.entry.name); // cancel
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
              className="ml-3 py-1 pl-8 font-['Inter'] text-[11px] text-[#556]"
              style={{ paddingLeft: `${depth * 12 + 28}px` }}
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

function UploadProgress({ progress }: { progress: number }) {
  if (progress >= 100 || progress <= 0) return null;
  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-[200px] rounded-[6px] border border-[rgba(255,255,255,0.08)] bg-[#111118] p-3"
      data-testid="upload-progress"
    >
      <div className="mb-1 font-['Inter'] text-[11px] text-[#889]">Uploading...</div>
      <div className="h-1 rounded-full bg-[rgba(255,255,255,0.08)] overflow-hidden">
        <div
          className="h-full rounded-full bg-[#af0] transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

/* ── Main FileTree Component ── */

export default function FileTree({
  projectId,
  onFileOpen,
  isMobile = false,
  onBack,
}: {
  projectId: string;
  onFileOpen: (projectId: string, filePath: string) => void;
  isMobile?: boolean;
  onBack?: () => void;
}) {
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
  const [searchValue, setSearchValue] = useState('');
  const [searchResults, setSearchResults] = useState<
    { name: string; path: string; type: 'file' | 'directory' }[]
  >([]);
  const [showSearch, setShowSearch] = useState(false);
  const [largeFileWarning, setLargeFileWarning] = useState<{ path: string; size: number } | null>(
    null,
  );
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTargetDir, setUploadTargetDir] = useState('');

  /* ── Fetch directory ── */
  const fetchDir = useCallback(
    async (dirPath: string): Promise<TreeNode[]> => {
      const entries = await apiFetch<FileEntry[]>(
        `/api/projects/${projectId}/files?path=${encodeURIComponent(dirPath)}`,
      );
      return entries.map((e) => ({
        entry: e,
        children: e.type === 'directory' ? null : null,
        loading: false,
      }));
    },
    [projectId],
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

  /* ── Lazy expand ── */
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail as { path: string; node: TreeNode };
      detail.node.loading = true;
      setTree([...tree]); // force re-render
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

  /* ── File open ── */
  const handleFileOpen = useCallback(
    async (filePath: string) => {
      // Check file size first
      try {
        const listing = await apiFetch<FileEntry[]>(
          `/api/projects/${projectId}/files?path=${encodeURIComponent(filePath.substring(0, filePath.lastIndexOf('/')))}`,
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
        await apiFetch(`/api/projects/${projectId}/files`, {
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

  /* ── Delete Operation ── */
  const handleDelete = useCallback(
    async (path: string, isDir: boolean) => {
      try {
        await apiFetch(
          `/api/projects/${projectId}/files?path=${encodeURIComponent(path)}${isDir ? '&force=true' : ''}`,
          { method: 'DELETE' },
        );
        await loadRoot();
        setShowDelete(null);
      } catch (err) {
        setError((err as ApiError).message || 'Failed to delete');
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
        await apiFetch(`/api/projects/${projectId}/files/rename`, {
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

  /* ── Upload ── */
  const handleUpload = useCallback(
    async (targetDir: string, file: File) => {
      const reader = new FileReader();
      setUploadProgress(10);
      reader.onload = async (e) => {
        setUploadProgress(50);
        const content = e.target?.result as string;
        const filePath = targetDir ? `${targetDir}/${file.name}` : file.name;
        try {
          await apiFetch(
            `/api/projects/${projectId}/files/write?path=${encodeURIComponent(filePath)}`,
            {
              method: 'PUT',
              body: JSON.stringify({ content }),
            },
          );
          setUploadProgress(100);
          setTimeout(() => setUploadProgress(0), 1000);
          await loadRoot();
        } catch (err) {
          setError((err as ApiError).message || 'Upload failed');
          setUploadProgress(0);
        }
      };
      reader.readAsText(file);
    },
    [projectId, loadRoot],
  );

  /* ── Drag & Drop ── */
  const handleDrop = useCallback(
    async (e: DragEvent, targetDir: string) => {
      e.preventDefault();
      const files = e.dataTransfer?.files;
      if (files) {
        for (let i = 0; i < files.length; i++) {
          await handleUpload(targetDir, files[i]);
        }
      }
    },
    [handleUpload],
  );

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
  }, []);

  /* ── Search with throttle ── */
  const handleSearch = useCallback(
    (val: string) => {
      setSearchValue(val);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      if (!val.trim()) {
        setSearchResults([]);
        return;
      }
      searchTimerRef.current = setTimeout(async () => {
        // Flatten tree and filter
        const results: { name: string; path: string; type: 'file' | 'directory' }[] = [];
        const flatten = (nodes: TreeNode[], parentPath: string) => {
          for (const n of nodes) {
            const p = parentPath ? `${parentPath}/${n.entry.name}` : n.entry.name;
            if (n.entry.name.toLowerCase().includes(val.toLowerCase())) {
              results.push({ name: n.entry.name, path: p, type: n.entry.type });
            }
            if (n.children) {
              flatten(n.children, p);
            } else if (n.entry.type === 'directory' && results.length < 20) {
              // For unloaded dirs, just match the name
            }
          }
        };
        flatten(tree, '');
        setSearchResults(results.slice(0, 20));
      }, 300);
    },
    [tree],
  );

  /* ── Keyboard shortcut ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        setShowSearch(true);
      }
    };
    window.addEventListener('keydown', handler as unknown as EventListener);
    return () => window.removeEventListener('keydown', handler as unknown as EventListener);
  }, []);

  /* ── Search selection ── */
  const handleSearchSelect = useCallback(
    (path: string, type: 'file' | 'directory') => {
      if (type === 'file') {
        handleFileOpen(path);
      } else {
        // Navigate to the directory
        setCurrentPath(path);
        // Clear and reload - we need to expand to this dir
        // For now, just navigate via breadcrumb
      }
      setShowSearch(false);
      setSearchValue('');
      setSearchResults([]);
    },
    [handleFileOpen],
  );

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

  return (
    <div className="flex h-full flex-col" data-testid="filetree-container">
      {/* Header with search toggle & upload */}
      <div className="flex items-center gap-2 border-b border-[rgba(255,255,255,0.08)] px-3 py-2">
        {isMobile && onBack && (
          <button
            onClick={onBack}
            className="mr-1 font-['Inter'] text-[11px] text-[#889] hover:text-[#ccd]"
          >
            Back
          </button>
        )}
        {showSearch ? (
          <div className="flex-1">
            <SearchBar
              value={searchValue}
              onChange={handleSearch}
              results={searchResults}
              onSelect={handleSearchSelect}
              onClose={() => {
                setShowSearch(false);
                setSearchValue('');
                setSearchResults([]);
              }}
            />
          </div>
        ) : (
          <>
            <button
              onClick={() => setShowSearch(true)}
              className="flex items-center gap-1 rounded-[4px] border border-[rgba(255,255,255,0.08)] px-2 py-1 font-['Inter'] text-[11px] text-[#889] hover:border-[rgba(255,255,255,0.15)] hover:text-[#ccd]"
              data-testid="search-toggle"
            >
              Ctrl+P
            </button>
            <div className="flex-1" />
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(uploadTargetDir || '', file);
                e.target.value = '';
              }}
              data-testid="file-upload-input"
            />
            <button
              onClick={() => {
                setUploadTargetDir(currentPath);
                fileInputRef.current?.click();
              }}
              className="rounded-[4px] border border-[rgba(255,255,255,0.08)] px-2 py-1 font-['Inter'] text-[11px] text-[#889] hover:border-[rgba(255,255,255,0.15)] hover:text-[#ccd]"
            >
              Upload
            </button>
          </>
        )}
      </div>

      {/* Breadcrumb */}
      <div className="border-b border-[rgba(255,255,255,0.06)] px-3">
        <Breadcrumb currentPath={currentPath} onNavigate={setCurrentPath} />
      </div>

      {/* Tree */}
      <div
        className="flex-1 overflow-y-auto py-1"
        onDragOver={handleDragOver}
        onDrop={(e) => handleDrop(e, currentPath)}
        role="tree"
        data-testid="file-tree"
      >
        {tree.length === 0 && (
          <div
            className="px-3 py-4 text-center font-['Inter'] text-[13px] text-[#556]"
            data-testid="filetree-empty"
          >
            Empty project
          </div>
        )}
        {tree.map((node) => (
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
      <UploadProgress progress={uploadProgress} />

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
}
