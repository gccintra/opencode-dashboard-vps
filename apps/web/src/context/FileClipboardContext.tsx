import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { getToken } from '../lib/api';

/* ── Types ── */

export interface GlobalClipboardItem {
  fileName: string;
  sourcePath: string;
  sourceApiBase: string;
  action: 'copy' | 'cut';
}

interface FileClipboardContextValue {
  clipboard: GlobalClipboardItem | null;
  setCopy: (fileName: string, sourcePath: string, sourceApiBase: string) => void;
  setCut: (fileName: string, sourcePath: string, sourceApiBase: string) => void;
  paste: (destApiBase: string, destDir: string) => Promise<{ ok: boolean; error?: string }>;
  clear: () => void;
}

/* ── Context ── */

const FileClipboardContext = createContext<FileClipboardContextValue | null>(null);

const STORAGE_KEY = 'global-file-clipboard';

function readFromStorage(): GlobalClipboardItem | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as GlobalClipboardItem) : null;
  } catch {
    return null;
  }
}

function writeToStorage(item: GlobalClipboardItem | null): void {
  try {
    if (item === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(item));
    }
  } catch {
    // ignore localStorage errors (private browsing, quota, etc.)
  }
}

/* ── Provider ── */

export function FileClipboardProvider({ children }: { children: ReactNode }) {
  const [clipboard, setClipboard] = useState<GlobalClipboardItem | null>(readFromStorage);

  const setCopy = useCallback((fileName: string, sourcePath: string, sourceApiBase: string) => {
    const item: GlobalClipboardItem = { fileName, sourcePath, sourceApiBase, action: 'copy' };
    writeToStorage(item);
    setClipboard(item);
  }, []);

  const setCut = useCallback((fileName: string, sourcePath: string, sourceApiBase: string) => {
    const item: GlobalClipboardItem = { fileName, sourcePath, sourceApiBase, action: 'cut' };
    writeToStorage(item);
    setClipboard(item);
  }, []);

  const clear = useCallback(() => {
    writeToStorage(null);
    setClipboard(null);
  }, []);

  const paste = useCallback(
    async (destApiBase: string, destDir: string): Promise<{ ok: boolean; error?: string }> => {
      if (!clipboard) return { ok: false, error: 'Nothing in clipboard' };

      const token = getToken();
      const authHeaders: Record<string, string> = {};
      if (token) authHeaders['Authorization'] = `Bearer ${token}`;

      const destPath = destDir ? `${destDir}/${clipboard.fileName}` : clipboard.fileName;

      try {
        // Same-project: use server-side copy or rename (handles directories correctly)
        if (clipboard.sourceApiBase === destApiBase) {
          if (clipboard.action === 'cut') {
            const res = await fetch(`${destApiBase}/rename`, {
              method: 'PUT',
              headers: { ...authHeaders, 'Content-Type': 'application/json' },
              body: JSON.stringify({ oldPath: clipboard.sourcePath, newPath: destPath }),
            });
            if (!res.ok) {
              const text = await res.text();
              return { ok: false, error: `Move failed: ${text}` };
            }
          } else {
            const res = await fetch(`${destApiBase}/copy`, {
              method: 'POST',
              headers: { ...authHeaders, 'Content-Type': 'application/json' },
              body: JSON.stringify({ sourcePath: clipboard.sourcePath, destPath }),
            });
            if (!res.ok) {
              const text = await res.text();
              return { ok: false, error: `Copy failed: ${text}` };
            }
          }
          clear();
          return { ok: true };
        }

        // Cross-project: download + upload (files only — directories not supported cross-project)
        const downloadUrl = `${clipboard.sourceApiBase}/download?path=${encodeURIComponent(clipboard.sourcePath)}`;
        const downloadRes = await fetch(downloadUrl, { headers: authHeaders });
        if (!downloadRes.ok) {
          const text = await downloadRes.text();
          return { ok: false, error: `Download failed: ${text}` };
        }
        const blob = await downloadRes.blob();

        const formData = new FormData();
        formData.append('file', new File([blob], clipboard.fileName));
        // path param is the target DIRECTORY, not the full path — server appends file.name
        const uploadUrl = `${destApiBase}/upload?path=${encodeURIComponent(destDir)}`;
        const uploadRes = await fetch(uploadUrl, {
          method: 'POST',
          headers: authHeaders,
          body: formData,
        });
        if (!uploadRes.ok) {
          const text = await uploadRes.text();
          return { ok: false, error: `Upload failed: ${text}` };
        }

        if (clipboard.action === 'cut') {
          const deleteUrl = `${clipboard.sourceApiBase}?path=${encodeURIComponent(clipboard.sourcePath)}`;
          await fetch(deleteUrl, { method: 'DELETE', headers: authHeaders });
        }

        clear();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Paste failed' };
      }
    },
    [clipboard, clear],
  );

  return (
    <FileClipboardContext.Provider value={{ clipboard, setCopy, setCut, paste, clear }}>
      {children}
    </FileClipboardContext.Provider>
  );
}

/* ── Hook ── */

export function useGlobalClipboard(): FileClipboardContextValue {
  const ctx = useContext(FileClipboardContext);
  if (!ctx) {
    throw new Error('useGlobalClipboard must be used inside FileClipboardProvider');
  }
  return ctx;
}
