import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';

interface SystemStats {
  cpu: number;
  memUsed: number;
  memTotal: number;
}

const POLL_INTERVAL = 5_000;

export function useSystemStats() {
  const [stats, setStats] = useState<SystemStats | null>(null);

  const fetch = useCallback(async () => {
    try {
      const data = await apiFetch<SystemStats>('/api/system/stats');
      setStats(data);
    } catch {
      // silent — keep last known data
    }
  }, []);

  useEffect(() => {
    fetch();
    const id = setInterval(fetch, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetch]);

  return stats;
}
