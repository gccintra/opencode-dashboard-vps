/**
 * EmergencyPage — dedicated page for the emergency root terminal.
 *
 * Shows a terminal with red/orange border styling to visually distinguish
 * it from normal project sessions. Fetches the emergency session on mount.
 */

import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, type ApiError } from '../lib/api';
import { XTermTerminal, ThemePicker } from '../components/Terminal';
import { getThemeId, saveThemeId, getThemeById } from '../lib/terminalThemes';

/* ── Types ── */

interface EmergencySession {
  sessionId: string;
  projectId: null;
  name: string;
  status: string;
  type: 'emergency';
  createdAt: number;
}

/* ── Mobile Detection ── */

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return isMobile;
}

/* ── Debounced Resize Hook ── */

function useDebouncedResize(sessionId: string | null) {
  return useCallback(
    (cols: number, rows: number) => {
      if (!sessionId) return;
      apiFetch(`/api/sessions/${sessionId}/resize`, {
        method: 'POST',
        body: JSON.stringify({ cols, rows }),
      }).catch(() => {
        // Resize failure is non-fatal — terminal still works.
      });
    },
    [sessionId],
  );
}

/* ── Icons ── */

function BackArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M9 3L5 7L9 11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseXIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path
        d="M2 2L10 10M10 2L2 10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="animate-spin" width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.25" />
      <path
        d="M12.5 7a5.5 5.5 0 00-5.5-5.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ── Page ── */

export default function EmergencyPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<EmergencySession | null>(null);
  const [closing, setClosing] = useState(false);

  const fetchSession = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<EmergencySession | { error: string }>('/api/emergency-terminal', {
        method: 'POST',
      });
      if ('sessionId' in data) {
        setSession(data as EmergencySession);
      } else {
        setError('Emergency terminal is not available');
      }
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.message || 'Failed to access emergency terminal');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  const onResize = useDebouncedResize(session?.sessionId ?? null);
  const isMobile = useIsMobile();

  const [themeId, setThemeId] = useState<string>(() => getThemeId());
  const handleThemeChange = useCallback((id: string) => {
    setThemeId(id);
    saveThemeId(id);
  }, []);

  const handleClose = useCallback(async () => {
    if (!session || closing) return;
    setClosing(true);
    try {
      await apiFetch(`/api/sessions/${session.sessionId}`, { method: 'DELETE' });
      setSession(null);
      navigate('/projects');
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.message || 'Failed to close session');
    } finally {
      setClosing(false);
    }
  }, [session, closing, navigate]);

  if (loading) {
    return (
      <div className="flex flex-1 min-h-0 flex-col bg-[#0a0a0f]">
        <div className="flex items-center justify-center flex-1">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#f54] border-t-transparent" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 min-h-0 flex-col bg-[#0a0a0f]">
        <div className="flex items-center justify-center flex-1 p-8">
          <div className="flex max-w-[420px] flex-col items-center gap-4 text-center">
            <p className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 font-['Inter'] text-[14px] text-red-400">
              {error}
            </p>
            <button
              onClick={() => navigate('/projects')}
              className="rounded-[6px] border border-white/[0.07] px-[16px] py-[8px] font-['Inter'] text-[13px] font-medium text-[#f0f0f0] hover:border-white/[0.14] transition-colors"
            >
              Back to Projects
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex flex-1 min-h-0 flex-col bg-[#0a0a0f]">
        <div className="flex items-center justify-center flex-1 p-8 text-center">
          <p className="font-['Inter'] text-[14px] text-[#9aa3ad]">No emergency session active.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-1 min-h-0 flex-col bg-[#0a0a0f]">
      {/* Atmosphere */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="kb-aurora" style={{ top: '-200px', left: '-140px', width: 600, height: 600, opacity: 0.3, background: 'radial-gradient(circle, rgba(179,229,2,0.15), rgba(179,229,2,0) 70%)' }} />
        <div className="kb-grid" />
      </div>
      {/* Header with emergency styling */}
      <header className="relative z-10 flex shrink-0 items-center gap-[12px] border-b-2 border-[#f54] bg-[#0a0a0f] px-[24px] pb-[18px] pt-[18px] sm:px-[32px]">
        <button
          onClick={() => navigate('/projects')}
          className="flex items-center gap-[4px] font-['Inter'] text-[13px] font-medium text-[#9aa3ad] hover:text-[#e6e8eb] transition-colors"
        >
          <BackArrowIcon />
          Projects
        </button>

        <span className="flex items-center gap-[6px] font-['Inter'] text-[15px] font-semibold text-[#f54]">
          <span>{'⚠️'}</span>
          Emergency Terminal
        </span>

        <div className="ml-auto flex items-center gap-[10px]">
          <ThemePicker themeId={themeId} onChange={handleThemeChange} direction="down" />
          <button
            onClick={handleClose}
            disabled={closing}
            className="flex items-center gap-[6px] rounded-[6px] border border-red-500/30 bg-red-500/10 px-[12px] py-[6px] font-['Inter'] text-[12px] font-medium text-red-400 hover:border-red-500/50 hover:bg-red-500/15 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            {closing ? (
              <>
                <SpinnerIcon />
                Closing…
              </>
            ) : (
              <>
                <CloseXIcon />
                Close Session
              </>
            )}
          </button>
        </div>
      </header>

      {error && (
        <div className="border-b border-red-500/30 bg-red-500/10 px-6 py-2 font-['Inter'] text-[12px] text-red-400">
          {error}
        </div>
      )}

      <main className="flex flex-1 min-h-0 flex-col overflow-hidden p-1 sm:p-3 md:p-4">
        <div className="flex h-full min-h-0 flex-1 overflow-hidden rounded-[8px] border-2 border-[rgba(255,85,68,0.3)] bg-[#0a0a0f]">
          <XTermTerminal
            sessionId={session.sessionId}
            onResize={onResize}
            fontSize={isMobile ? 12 : 14}
            theme={getThemeById(themeId).xterm}
          />
        </div>
      </main>
    </div>
  );
}
