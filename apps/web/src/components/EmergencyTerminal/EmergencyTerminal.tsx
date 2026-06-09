/**
 * EmergencyTerminal — floating button + confirmation modal for root access.
 *
 * Displays "⚠️ Terminal de Emergência" on all pages when no emergency
 * session is active. If one exists, shows "Terminal de Emergência Ativo"
 * and clicking focuses it. The modal asks for confirmation before opening.
 */

import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../lib/api';

export interface EmergencySession {
  sessionId: string;
  projectId: null;
  name: string;
  status: string;
  type: 'emergency';
  createdAt: number;
}

export interface EmergencyTerminalProps {
  /** Callback fired after successfully creating a session. */
  onSessionCreated?: (session: EmergencySession) => void;
}

export default function EmergencyTerminal({ onSessionCreated }: EmergencyTerminalProps) {
  const navigate = useNavigate();
  const [showModal, setShowModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Check for existing emergency session on first mount only — this was
  // previously a side-effect during component render (a React anti-pattern
  // that caused infinite re-render loops). Now it's in useEffect with a
  // cleanup guard so setActiveSessionId is never called after unmount.
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ type?: string; sessionId?: string; status?: string }[]>('/api/agents')
      .then((agents) => {
        if (cancelled) return;
        const emergency = Array.isArray(agents)
          ? agents.find(
              (a) => a.type === 'emergency' && a.status !== 'exited' && a.status !== 'killed',
            )
          : null;
        if (emergency?.sessionId) {
          setActiveSessionId(emergency.sessionId);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleClick = useCallback(() => {
    if (activeSessionId) {
      navigate(`/emergency`);
      return;
    }
    setShowModal(true);
    setError(null);
  }, [activeSessionId, navigate]);

  const handleConfirm = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const session = await apiFetch<EmergencySession>('/api/emergency-terminal', {
        method: 'POST',
      });
      onSessionCreated?.(session);
      setShowModal(false);
      navigate(`/emergency`);
    } catch (err) {
      setError((err as { message?: string }).message || 'Failed to create emergency terminal');
    } finally {
      setCreating(false);
    }
  }, [onSessionCreated, navigate]);

  const handleCancel = useCallback(() => {
    setShowModal(false);
    setError(null);
  }, []);

  return (
    <>
      {/* Floating button */}
      <button
        onClick={handleClick}
        className={`flex items-center gap-[6px] rounded-[8px] border px-[12px] py-[7px] font-['Inter'] text-[12px] font-medium transition-colors ${
          activeSessionId
            ? 'border-[rgba(255,170,0,0.3)] bg-[rgba(255,170,0,0.08)] text-[#fa0] hover:bg-[rgba(255,170,0,0.15)]'
            : 'border-[rgba(255,85,68,0.2)] bg-[rgba(255,85,68,0.06)] text-[#f54] hover:bg-[rgba(255,85,68,0.12)]'
        }`}
        data-testid="emergency-terminal-button"
      >
        <span className="font-['Inter'] text-[13px]" data-testid="emergency-terminal-label">
          {activeSessionId ? (
            <>
              <span className="mr-[2px]">{'⚠️'}</span>
              {'Terminal de Emergência Ativo'}
            </>
          ) : (
            <>
              <span className="mr-[2px]">{'⚠️'}</span>
              {'Terminal de Emergência'}
            </>
          )}
        </span>
      </button>

      {/* Confirmation modal */}
      {showModal && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 z-50 bg-black/60"
            onClick={handleCancel}
            data-testid="emergency-modal-overlay"
          />

          {/* Modal */}
          <div
            className="fixed left-1/2 top-1/2 z-50 w-[340px] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 rounded-[12px] border border-[rgba(255,85,68,0.3)] bg-[#0d0d14] p-[24px] shadow-2xl"
            data-testid="emergency-modal"
          >
            {/* Warning header */}
            <div className="mb-[16px] flex items-center gap-[8px]">
              <span className="text-[20px]">{'⚠️'}</span>
              <h2 className="font-['Inter'] text-[16px] font-semibold text-[#f54]">
                Terminal de Emergência
              </h2>
            </div>

            <p className="mb-[20px] font-['Inter'] text-[13px] leading-[1.5] text-[#889]">
              Esta ação abre um terminal com acesso <strong className="text-[#f54]">root</strong> ao
              sistema no diretório <code className="text-[#f0f0f0]">/root</code>. Use com cuidado.
            </p>

            {error && (
              <p
                className="mb-[16px] rounded-[6px] border border-red-500/20 bg-red-500/10 px-[12px] py-[8px] font-['Inter'] text-[12px] text-red-400"
                data-testid="emergency-modal-error"
              >
                {error}
              </p>
            )}

            <div className="flex items-center gap-[10px]">
              <button
                onClick={handleCancel}
                className="flex-1 rounded-[8px] border border-[rgba(255,255,255,0.08)] px-[16px] py-[10px] font-['Inter'] text-[13px] font-medium text-[#889] hover:bg-[rgba(255,255,255,0.06)] transition-colors"
                data-testid="emergency-modal-cancel"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirm}
                disabled={creating}
                className="flex-1 rounded-[8px] bg-[#f54] px-[16px] py-[10px] font-['Inter'] text-[13px] font-semibold text-white hover:bg-[#e43] transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="emergency-modal-confirm"
              >
                {creating ? 'Criando…' : 'Abrir Terminal'}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
