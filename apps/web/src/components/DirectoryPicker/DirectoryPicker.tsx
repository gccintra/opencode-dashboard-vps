import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../../lib/api';
import DirectoryBrowseModal from './DirectoryBrowseModal';

interface DirectoryEntry {
  name: string;
  path: string;
}

interface Props {
  value: string;
  onChange: (path: string) => void;
  error?: string;
  disabled?: boolean;
  placeholder?: string;
}

export default function DirectoryPicker({ value, onChange, error, disabled, placeholder }: Props) {
  const [inputValue, setInputValue] = useState(value);
  const [suggestions, setSuggestions] = useState<DirectoryEntry[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [browseModalOpen, setBrowseModalOpen] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const fetchSuggestions = useCallback(async (path: string) => {
    if (!path.trim()) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }

    const cleaned = path.trim();

    try {
      const data = await apiFetch<{ directories: DirectoryEntry[] }>(
        `/api/files/directories?path=${encodeURIComponent(cleaned)}`,
      );
      setSuggestions(data.directories);
      setShowDropdown(data.directories.length > 0);
      setHighlightedIdx(-1);
    } catch {
      const lastSlash = cleaned.lastIndexOf('/');
      if (lastSlash > 0) {
        const parent = cleaned.substring(0, lastSlash) || '/';
        const partial = cleaned.substring(lastSlash + 1);
        try {
          const data = await apiFetch<{ directories: DirectoryEntry[] }>(
            `/api/files/directories?path=${encodeURIComponent(parent)}`,
          );
          const filtered = data.directories.filter((d) =>
            d.name.toLowerCase().startsWith(partial.toLowerCase()),
          );
          setSuggestions(filtered);
          setShowDropdown(filtered.length > 0);
        } catch {
          setSuggestions([]);
          setShowDropdown(false);
        }
      } else {
        setSuggestions([]);
        setShowDropdown(false);
      }
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    onChange(val);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchSuggestions(val);
    }, 300);
  };

  const handleSuggestionClick = (entry: DirectoryEntry) => {
    setInputValue(entry.path);
    onChange(entry.path);
    setShowDropdown(false);
    setHighlightedIdx(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIdx((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIdx((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
    } else if (e.key === 'Enter' && highlightedIdx >= 0) {
      e.preventDefault();
      handleSuggestionClick(suggestions[highlightedIdx]);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
      setHighlightedIdx(-1);
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
        setHighlightedIdx(-1);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleBrowseSelect = (path: string) => {
    setInputValue(path);
    onChange(path);
  };

  return (
    <>
      <div ref={containerRef} className="relative">
        <div className="flex gap-[8px]">
          <input
            id="project-directory"
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            className="flex-1 rounded-[8px] border border-white/[0.07] bg-[#0a0a0f] px-[12px] py-[9px] font-['JetBrains_Mono'] text-[13px] text-[#f0f0f0] placeholder:text-[#5a626c] outline-none focus:border-white/[0.14] disabled:opacity-50"
            placeholder={placeholder || '/home/user/projects/my-project'}
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setBrowseModalOpen(true)}
            disabled={disabled}
            className="rounded-[8px] border border-white/[0.07] bg-[#0a0a0f] px-[12px] py-[9px] text-[13px] text-[#9aa3ad] hover:border-white/[0.14] hover:text-[#e6e8eb] transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            Browse
          </button>
        </div>

        {showDropdown && (
          <div className="absolute left-0 right-0 top-full mt-[4px] max-h-[200px] overflow-y-auto rounded-[8px] border border-white/[0.07] bg-[#111118] z-50 shadow-lg">
            {suggestions.map((entry, idx) => (
              <button
                key={entry.path}
                type="button"
                onClick={() => handleSuggestionClick(entry)}
                onMouseEnter={() => setHighlightedIdx(idx)}
                className={`w-full flex items-center gap-[8px] px-[12px] py-[8px] text-left font-['JetBrains_Mono'] text-[12px] transition-colors ${
                  idx === highlightedIdx
                    ? 'bg-[rgba(179,229,2,0.1)] text-[#b3e502]'
                    : 'text-[#ccd] hover:bg-[rgba(255,255,255,0.04)]'
                }`}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#5a626c"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                <span className="truncate">{entry.path}</span>
              </button>
            ))}
          </div>
        )}

        {error && <p className="mt-[4px] text-[12px] text-red-400">{error}</p>}
      </div>

      <DirectoryBrowseModal
        isOpen={browseModalOpen}
        onClose={() => setBrowseModalOpen(false)}
        onSelect={handleBrowseSelect}
        initialPath={value || '/'}
      />
    </>
  );
}
