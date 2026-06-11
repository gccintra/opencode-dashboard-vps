import { useState, useCallback } from 'react';

export interface ClipboardItem {
  sourcePath: string;
  projectId: string;
  action: 'copy';
}

const STORAGE_KEY = 'file-clipboard';

function readFromStorage(): ClipboardItem | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ClipboardItem) : null;
  } catch {
    return null;
  }
}

export function useFileClipboard() {
  const [clipboard, setClipboard] = useState<ClipboardItem | null>(readFromStorage);

  const copy = useCallback((projectId: string, sourcePath: string) => {
    const item: ClipboardItem = { sourcePath, projectId, action: 'copy' };
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(item));
    } catch {
      // sessionStorage unavailable (private browsing restrictions etc.)
    }
    setClipboard(item);
  }, []);

  const clear = useCallback(() => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    setClipboard(null);
  }, []);

  return { clipboard, copy, clear };
}
