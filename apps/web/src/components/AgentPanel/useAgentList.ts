/**
 * useAgentList — hook for fetching and polling the agent list.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch, type ApiError } from '../../lib/api';

export interface AgentInfo {
  id: string;
  name: string;
  projectId: string | null;
  projectName: string | null;
  status: string;
  type: string;
  createdAt: number;
  lastActiveAt: number;
  outputPreview: string;
  linkedTaskId?: string;
  linkedTaskTitle?: string;
}

export interface AgentMetrics {
  total: number;
  active: number;
  waiting: number;
  finished: number;
  emergency: number;
}

export interface UseAgentListReturn {
  agents: AgentInfo[];
  metrics: AgentMetrics;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  closeAgent: (id: string) => Promise<void>;
  renameAgent: (id: string, name: string) => Promise<void>;
}

const POLL_INTERVAL_MS = 5_000;

export function useAgentList(): UseAgentListReturn {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [metrics, setMetrics] = useState<AgentMetrics>({
    total: 0,
    active: 0,
    waiting: 0,
    finished: 0,
    emergency: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [agentsData, metricsData] = await Promise.all([
        apiFetch<AgentInfo[]>('/api/agents'),
        apiFetch<AgentMetrics>('/api/agents/metrics'),
      ]);
      setAgents(Array.isArray(agentsData) ? agentsData : []);
      if (metricsData && typeof metricsData === 'object') {
        setMetrics(metricsData);
      }
      setError(null);
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.message) setError(apiErr.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + polling.
  useEffect(() => {
    fetchData();
    pollTimerRef.current = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [fetchData]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await fetchData();
  }, [fetchData]);

  const closeAgent = useCallback(async (id: string) => {
    try {
      await apiFetch(`/api/sessions/${id}`, { method: 'DELETE' });
      setAgents((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      const apiErr = err as ApiError;
      // 404 means session is already gone — remove it from the list silently.
      if (apiErr.status === 404) {
        setAgents((prev) => prev.filter((a) => a.id !== id));
        return;
      }
      if (apiErr.message) setError(apiErr.message);
    }
  }, []);

  const renameAgent = useCallback(async (id: string, name: string) => {
    try {
      const updated = await apiFetch<AgentInfo>(`/api/sessions/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      });
      if (updated && typeof updated.name === 'string') {
        setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, name: updated.name } : a)));
      }
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status === 404) return; // session gone, ignore
      if (apiErr.message) setError(apiErr.message);
    }
  }, []);

  return { agents, metrics, loading, error, refresh, closeAgent, renameAgent };
}
