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
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      try {
        // 1. Download from source
        const downloadUrl = `${clipboard.sourceApiBase}/download?path=${encodeURIComponent(clipboard.sourcePath)}`;
        const downloadRes = await fetch(downloadUrl, { headers });
        if (!downloadRes.ok) {
          const text = await downloadRes.text();
          return { ok: false, error: `Download failed: ${text}` };
        }
        const blob = await downloadRes.blob();

        // 2. Upload to destination
        const uploadPath = destDir
          ? `${destDir}/${clipboard.fileName}`
          : clipboard.fileName;
        const formData = new FormData();
        formData.append('file', new File([blob], clipboard.fileName));
        const uploadUrl = `${destApiBase}/upload?path=${encodeURIComponent(uploadPath)}`;
        const uploadRes = await fetch(uploadUrl, {
          method: 'POST',
          headers,
          body: formData,
        });
        if (!uploadRes.ok) {
          const text = await uploadRes.text();
          return { ok: false, error: `Upload failed: ${text}` };
        }

        // 3. If cut, delete from source
        if (clipboard.action === 'cut') {
          const deleteUrl = `${clipboard.sourceApiBase}?path=${encodeURIComponent(clipboard.sourcePath)}`;
          await fetch(deleteUrl, {
            method: 'DELETE',
            headers,
          });
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
