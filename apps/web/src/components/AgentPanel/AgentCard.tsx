/**
 * AgentCard — compact visual card for an agent (session).
 *
 * Displays session name, status badge, project name, uptime,
 * output preview, and action buttons (close, rename).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import StatusBadge, { type BadgeStatus } from '../StatusBadge/StatusBadge';
import type { AgentInfo } from './useAgentList';

/* ── Inline SVG icons ── */

function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path
        d="M8.5 1.5a1.41 1.41 0 0 1 2 2L3.5 10.5l-2.5.5.5-2.5L8.5 1.5z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ── Uptime formatter ── */

function formatUptime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return `${min}m ${sec}s`;
  const hrs = Math.floor(min / 60);
  const remainMin = min % 60;
  return `${hrs}h ${remainMin}m`;
}

export interface AgentCardProps {
  agent: AgentInfo;
  /** Called when the user confirms closing this session. */
  onClose: (id: string) => void;
  /** Called when the user renames this session. */
  onRename: (id: string, name: string) => void;
  /** Whether the card should pulse (waiting state). */
  pulse?: boolean;
  /** Whether the card is stale (> 15s since last update). */
  stale?: boolean;
  /** Whether to show a "Create task" button. */
  showCreateTask?: boolean;
  /** Called when "Create task" is clicked. */
  onCreateTask?: (agent: AgentInfo) => void;
}

export default function AgentCard({
  agent,
  onClose,
  onRename,
  pulse = false,
  stale = false,
  showCreateTask = false,
  onCreateTask,
}: AgentCardProps) {
  const navigate = useNavigate();
  const [confirmClose, setConfirmClose] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(agent.name);
  const [uptime, setUptime] = useState(() => formatUptime(Date.now() - agent.createdAt));
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Update uptime every 30s.
  useEffect(() => {
    const timer = setInterval(() => {
      setUptime(formatUptime(Date.now() - agent.createdAt));
    }, 30_000);
    return () => clearInterval(timer);
  }, [agent.createdAt]);

  // Focus rename input when active.
  useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renaming]);

  // Close confirmation timeout.
  useEffect(() => {
    if (!confirmClose) return;
    const timer = setTimeout(() => setConfirmClose(false), 5_000);
    return () => clearTimeout(timer);
  }, [confirmClose]);

  const isEmergency = agent.type === 'emergency';
  const isFinished = agent.status === 'finished';

  const badgeStatus: BadgeStatus = isEmergency
    ? 'emergency'
    : isFinished
      ? 'finished'
      : agent.status === 'waiting'
        ? 'waiting'
        : 'active';

  const handleClick = useCallback(() => {
    if (isFinished) return;
    if (isEmergency) {
      navigate('/emergency');
    } else if (agent.projectId) {
      navigate(`/projects/${agent.projectId}`);
    }
  }, [isFinished, isEmergency, agent.projectId, navigate]);

  const handleRenameSubmit = useCallback(() => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== agent.name) {
      onRename(agent.id, trimmed);
    }
    setRenaming(false);
  }, [renameValue, agent.name, agent.id, onRename]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleRenameSubmit();
      else if (e.key === 'Escape') setRenaming(false);
    },
    [handleRenameSubmit],
  );

  return (
    <div
      className={`relative rounded-[8px] border bg-[#111118] px-[12px] py-[10px] transition-all select-none ${
        isEmergency
          ? 'border-[rgba(255,85,68,0.4)] bg-[rgba(255,85,68,0.04)]'
          : 'border-white/[0.07]'
      } ${isFinished ? 'opacity-50' : ''} ${stale ? 'border-[rgba(255,170,0,0.3)]' : ''} ${
        pulse ? 'animate-pulse' : ''
      }`}
      data-testid={`agent-card-${agent.id}`}
    >
      {/* Top line: name + status */}
      <div className="flex items-center gap-[6px]">
        {isEmergency && (
          <span className="text-[10px] font-bold text-[#f54] shrink-0">
            {'⚠️ Root'}
          </span>
        )}
        {renaming ? (
          <input
            ref={renameInputRef}
            className="flex-1 min-w-0 rounded-[4px] border border-[rgba(179,229,2,0.3)] bg-[#0a0a0f] px-[6px] py-[1px] text-[12px] text-[#f0f0f0] outline-none"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={handleRenameSubmit}
            onClick={(e) => e.stopPropagation()}
            data-testid={`rename-input-${agent.id}`}
          />
        ) : (
          <span
            className="flex-1 min-w-0 truncate text-[13px] font-semibold text-[#f0f0f0] cursor-pointer"
            onClick={handleClick}
            data-testid={`agent-name-${agent.id}`}
          >
            {agent.name}
          </span>
        )}
        <StatusBadge status={badgeStatus} size="sm" />
      </div>

      {/* Middle line: project + uptime */}
      <div className="mt-[4px] flex items-center gap-[8px] cursor-pointer" onClick={handleClick}>
        <span className="min-w-0 truncate text-[11px] text-[#9aa3ad]">
          {agent.projectName || (isEmergency ? '/root' : '—')}
        </span>
        <span className="shrink-0 font-['JetBrains_Mono'] text-[10px] text-[#5a626c]">{uptime}</span>
        {isFinished && (
          <span className="shrink-0 text-[10px] text-[#5a626c]">ended</span>
        )}
        {stale && !isFinished && (
          <span className="shrink-0 text-[10px] text-[#fa0]">stale</span>
        )}
      </div>

      {/* Bottom line: output preview */}
      <div className="mt-[4px] cursor-pointer" onClick={handleClick}>
        <span className="block truncate font-['JetBrains_Mono'] text-[10px] leading-[16px] text-[#5a626c]">
          {agent.outputPreview}
        </span>
      </div>

      {/* Linked task */}
      {agent.linkedTaskTitle && (
        <div
          className="mt-[4px] cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            navigate('/tasks');
          }}
        >
          <span className="text-[11px] text-[#b3e502] hover:underline">
            {'📋 '}
            {agent.linkedTaskTitle}
          </span>
        </div>
      )}

      {/* Action buttons */}
      <div className="mt-[6px] flex items-center gap-[4px]">
        {showCreateTask && !isFinished && !isEmergency && (
          <button
            className="flex items-center gap-[3px] rounded-[4px] border border-white/[0.07] px-[6px] py-[2px] text-[10px] text-[#9aa3ad] hover:border-[rgba(179,229,2,0.3)] hover:text-[#b3e502] transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onCreateTask?.(agent);
            }}
            data-testid={`create-task-${agent.id}`}
          >
            + Task
          </button>
        )}
        <button
          className="flex size-[20px] items-center justify-center rounded-[3px] text-[#5a626c] hover:bg-[rgba(255,255,255,0.06)] hover:text-[#f0f0f0] transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            setRenaming(true);
            setRenameValue(agent.name);
          }}
          aria-label={`Rename ${agent.name}`}
          data-testid={`rename-btn-${agent.id}`}
        >
          <PencilIcon />
        </button>
        {confirmClose ? (
          <div className="flex items-center gap-[4px]" data-testid={`confirm-close-${agent.id}`}>
            <button
              className="rounded-[3px] bg-[#f54] px-[6px] py-[1px] text-[10px] font-medium text-white hover:bg-[#e43] transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onClose(agent.id);
                setConfirmClose(false);
              }}
              data-testid={`confirm-close-yes-${agent.id}`}
            >
              {isEmergency ? 'End' : 'Yes'}
            </button>
            <button
              className="rounded-[3px] bg-[rgba(255,255,255,0.08)] px-[6px] py-[1px] text-[10px] text-[#9aa3ad] hover:bg-[rgba(255,255,255,0.12)] transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmClose(false);
              }}
              data-testid={`confirm-close-no-${agent.id}`}
            >
              No
            </button>
          </div>
        ) : (
          <button
            className="flex size-[20px] items-center justify-center rounded-[3px] text-[#5a626c] hover:bg-[rgba(255,50,50,0.15)] hover:text-[#f54] transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmClose(true);
            }}
            aria-label={`Close ${agent.name}`}
            data-testid={`close-btn-${agent.id}`}
          >
            <CloseIcon />
          </button>
        )}
      </div>
    </div>
  );
}
