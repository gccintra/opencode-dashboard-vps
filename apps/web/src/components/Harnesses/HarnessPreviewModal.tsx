import { useState } from 'react';
import HarnessFileTree from './HarnessFileTree';
import type { FileEntry } from '../../lib/api';

interface Props {
  open: boolean;
  harnesses: Array<{ id: string; name: string; description: string }>;
  harnessesLoading: boolean;
  preview: { files: Array<FileEntry>; conflicts: string[] } | null;
  previewLoading: boolean;
  selectedHarnessId: string | null;
  onHarnessChange: (id: string | null) => void;
  onApply: (overwrite: boolean) => void;
  applying: boolean;
  applyError: string | null;
  onClose: () => void;
}

export default function HarnessPreviewModal({
  open,
  harnesses,
  harnessesLoading,
  preview,
  previewLoading,
  selectedHarnessId,
  onHarnessChange,
  onApply,
  applying,
  applyError,
  onClose,
}: Props) {
  const [overwrite, setOverwrite] = useState(false);

  if (!open) return null;

  const hasConflicts = preview && preview.conflicts.length > 0;
  const selectedHarness = harnesses.find((h) => h.id === selectedHarnessId);

  const conflictPaths = new Set(preview?.conflicts ?? []);

  const renderPreview = () => {
    if (!selectedHarnessId) {
      return (
        <div className="flex items-center justify-center py-[48px]">
          <span className="font-['Inter'] text-[14px] text-[#5a626c]">
            Select a template to preview its files
          </span>
        </div>
      );
    }

    if (previewLoading) {
      return (
        <div className="space-y-[8px] py-[16px]">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-[20px] rounded-[4px] bg-[rgba(255,255,255,0.04)] animate-pulse"
              style={{ width: `${60 + Math.random() * 30}%` }}
            />
          ))}
        </div>
      );
    }

    if (!preview) {
      return (
        <div className="flex items-center justify-center py-[48px]">
          <span className="font-['Inter'] text-[14px] text-[#5a626c]">
            Select a template to preview its files
          </span>
        </div>
      );
    }

    return (
      <div>
        <div className="max-h-[300px] overflow-y-auto rounded-[8px] border border-[rgba(255,255,255,0.06)] bg-[#0a0a0f] p-[8px]">
          <HarnessFileTree
            files={preview.files}
            conflictPaths={conflictPaths}
          />
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-[560px] rounded-[12px] border border-white/[0.07] bg-[#111118] p-[24px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-[20px]">
          <h3 className="font-['Inter'] text-[16px] font-semibold text-[#f0f0f0]">
            Apply Template
          </h3>
          <button
            onClick={onClose}
            className="text-[#5a626c] hover:text-[#9aa3ad] transition-colors text-[18px] leading-none"
          >
            ✕
          </button>
        </div>

        {/* Harness selector */}
        <div className="mb-[16px]">
          <label className="mb-[6px] block font-['Inter'] text-[13px] font-medium text-[#9aa3ad]">
            Template
          </label>
          {harnessesLoading ? (
            <div className="h-[38px] rounded-[8px] bg-[rgba(255,255,255,0.04)] animate-pulse" />
          ) : (
            <select
              value={selectedHarnessId ?? ''}
              onChange={(e) =>
                onHarnessChange(e.target.value || null)
              }
              className="w-full rounded-[8px] border border-white/[0.07] bg-[#0a0a0f] px-[12px] py-[9px] font-['Inter'] text-[14px] text-[#f0f0f0] appearance-none cursor-pointer focus:outline-none focus:border-[#b3e502] transition-colors"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23889' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 12px center',
                backgroundSize: '14px',
              }}
            >
              <option value="" className="bg-[#0a0a0f] text-[#5a626c]">
                Select a template...
              </option>
              {harnesses.map((h) => (
                <option
                  key={h.id}
                  value={h.id}
                  className="bg-[#0a0a0f] text-[#f0f0f0]"
                >
                  {h.name}
                </option>
              ))}
            </select>
          )}
          {selectedHarness && (
            <p className="mt-[6px] font-['Inter'] text-[12px] text-[#5a626c]">
              {selectedHarness.description}
            </p>
          )}
        </div>

        {/* Divider */}
        <div className="mb-[16px] border-t border-[rgba(255,255,255,0.06)]" />

        {/* Preview label */}
        <div className="mb-[8px] font-['Inter'] text-[13px] font-medium text-[#9aa3ad]">
          Preview
        </div>

        {/* Preview area */}
        {renderPreview()}

        {/* Conflict warning banner */}
        {hasConflicts && preview!.conflicts.length > 0 && (
          <div className="mt-[12px] flex items-start gap-[10px] rounded-[8px] border border-[rgba(255,200,0,0.2)] bg-[rgba(255,200,0,0.06)] px-[12px] py-[10px]">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#fc0"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mt-[1px] shrink-0"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span className="font-['Inter'] text-[13px] text-[#fc0]">
              {preview!.conflicts.length} file(s) already exist in this project.
              Enable overwrite to replace them.
            </span>
          </div>
        )}

        {/* Overwrite checkbox */}
        {hasConflicts && preview!.conflicts.length > 0 && (
          <label className="mt-[10px] flex items-center gap-[8px] cursor-pointer">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
              className="h-[16px] w-[16px] rounded-[3px] border border-[rgba(255,255,255,0.12)] bg-[#0a0a0f] accent-[#b3e502] cursor-pointer"
            />
            <span className="font-['Inter'] text-[13px] text-[#ccd]">
              Overwrite existing files
            </span>
          </label>
        )}

        {/* Error banner */}
        {applyError && (
          <div className="mt-[12px] flex items-start gap-[10px] rounded-[8px] border border-[rgba(255,50,50,0.2)] bg-[rgba(255,50,50,0.06)] px-[12px] py-[10px]">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#f55"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mt-[1px] shrink-0"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            <span className="font-['Inter'] text-[13px] text-[#f55]">
              {applyError}
            </span>
          </div>
        )}

        {/* Action buttons */}
        <div className="mt-[20px] flex justify-end gap-[10px]">
          <button
            onClick={onClose}
            disabled={applying}
            className="rounded-[6px] border border-white/[0.07] px-[16px] py-[8px] font-['Inter'] text-[13px] font-medium text-[#9aa3ad] hover:border-white/[0.14] hover:text-[#e6e8eb] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={() => onApply(overwrite)}
            disabled={!selectedHarnessId || applying}
            className="rounded-[6px] bg-[#b3e502] px-[16px] py-[8px] font-['Inter'] text-[13px] font-semibold text-[#0a0a0f] hover:bg-[#c2f516] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-[8px]"
          >
            {applying ? (
              <>
                <div className="h-[14px] w-[14px] animate-spin rounded-full border-2 border-[#0a0a0f] border-t-transparent" />
                Applying...
              </>
            ) : (
              'Apply Template'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
