import { useState, useEffect, useCallback } from 'react';
import { apiFetch, type ApiError } from '../../lib/api';

interface DirectoryEntry {
  name: string;
  path: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
}

export default function DirectoryBrowseModal({ isOpen, onClose, onSelect, initialPath }: Props) {
  const [currentPath, setCurrentPath] = useState(initialPath || '/');
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDirectories = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ directories: DirectoryEntry[] }>(
        `/api/files/directories?path=${encodeURIComponent(path)}`,
      );
      setEntries(data.directories);
    } catch (err) {
      setError((err as ApiError).message || 'Failed to load directories');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setCurrentPath(initialPath || '/');
    }
  }, [isOpen, initialPath]);

  useEffect(() => {
    if (isOpen) {
      fetchDirectories(currentPath);
    }
  }, [isOpen, currentPath, fetchDirectories]);

  const breadcrumbs = currentPath
    .split('/')
    .filter(Boolean)
    .reduce<{ label: string; path: string }[]>((acc, part, idx, parts) => {
      const path = '/' + parts.slice(0, idx + 1).join('/');
      acc.push({ label: part, path });
      return acc;
    }, []);

  const handleSelect = () => {
    onSelect(currentPath);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-[480px] rounded-[12px] border border-[rgba(255,255,255,0.08)] bg-[#111118] p-[24px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-[16px]">
          <h3 className="font-['Inter'] text-[16px] font-semibold text-[#f0f0f0]">
            Select Directory
          </h3>
          <button
            onClick={onClose}
            className="text-[#556] hover:text-[#889] transition-colors text-[18px] leading-none"
          >
            ✕
          </button>
        </div>

        {/* Breadcrumbs */}
        <div className="flex items-center gap-[4px] mb-[12px] flex-wrap">
          <button
            onClick={() => setCurrentPath('/')}
            className="font-['Inter'] text-[13px] text-[#556] hover:text-[#af0] transition-colors"
          >
            /
          </button>
          {breadcrumbs.map((crumb) => (
            <span key={crumb.path} className="flex items-center gap-[4px]">
              <span className="text-[#445] text-[13px]">/</span>
              <button
                onClick={() => setCurrentPath(crumb.path)}
                className="font-['Inter'] text-[13px] text-[#556] hover:text-[#af0] truncate max-w-[120px] transition-colors"
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </div>

        {/* Current path */}
        <div className="mb-[12px] rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[#0a0a0f] px-[12px] py-[8px] font-['JetBrains_Mono'] text-[12px] text-[#889]">
          {currentPath}
        </div>

        {/* Directory list */}
        <div className="max-h-[240px] overflow-y-auto rounded-[8px] border border-[rgba(255,255,255,0.06)] bg-[#0a0a0f]">
          {loading ? (
            <div className="flex items-center justify-center py-[24px]">
              <div className="h-[20px] w-[20px] animate-spin rounded-full border-2 border-[#af0] border-t-transparent" />
            </div>
          ) : error ? (
            <div className="px-[12px] py-[16px] font-['Inter'] text-[13px] text-red-400 text-center">
              {error}
            </div>
          ) : entries.length === 0 ? (
            <div className="px-[12px] py-[16px] font-['Inter'] text-[13px] text-[#445] text-center">
              No directories found
            </div>
          ) : (
            entries.map((entry) => (
              <button
                key={entry.path}
                onClick={() => setCurrentPath(entry.path)}
                className="w-full flex items-center gap-[8px] px-[12px] py-[8px] text-left font-['Inter'] text-[13px] text-[#ccd] hover:bg-[rgba(255,255,255,0.04)] transition-colors border-b border-[rgba(255,255,255,0.04)] last:border-b-0"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#556"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                <span className="truncate">{entry.name}</span>
              </button>
            ))
          )}
        </div>

        {/* Action buttons */}
        <div className="mt-[16px] flex justify-end gap-[10px]">
          <button
            onClick={onClose}
            className="rounded-[6px] border border-[rgba(255,255,255,0.08)] px-[16px] py-[8px] font-['Inter'] text-[13px] font-medium text-[#889] hover:border-[rgba(255,255,255,0.16)] hover:text-[#ccd] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSelect}
            className="rounded-[6px] bg-[#af0] px-[16px] py-[8px] font-['Inter'] text-[13px] font-semibold text-[#0a0a0f] hover:bg-[#9e0] transition-colors"
          >
            Select this directory
          </button>
        </div>
      </div>
    </div>
  );
}
