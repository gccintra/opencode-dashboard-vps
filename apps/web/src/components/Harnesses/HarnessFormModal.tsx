import { useState, useEffect } from 'react';

interface HarnessFormData {
  name: string;
  description: string;
}

interface HarnessFormModalProps {
  open: boolean;
  title: string;
  initial: HarnessFormData;
  onClose: () => void;
  onSubmit: (data: HarnessFormData) => void;
  error: string | null;
  loading: boolean;
}

const NAME_MAX_LENGTH = 64;

export function HarnessFormModal({
  open,
  title,
  initial,
  onClose,
  onSubmit,
  error,
  loading,
}: HarnessFormModalProps) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [nameError, setNameError] = useState('');

  useEffect(() => {
    if (open) {
      setName(initial.name);
      setDescription(initial.description);
      setNameError('');
    }
  }, [open, initial]);

  const handleSubmit = () => {
    if (!name.trim()) {
      setNameError('Name is required');
      return;
    }
    setNameError('');
    onSubmit({ name: name.trim(), description: description.trim() });
  };

  const submitLabel = title.toLowerCase().includes('new') ? 'Create' : 'Save';

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-[420px] rounded-[14px] border border-white/[0.08] bg-[#111118] p-[24px] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[18px] font-bold text-white">{title}</h3>

        <div className="mt-[18px] space-y-[14px]">
          {/* Name */}
          <div>
            <label
              htmlFor="harness-name"
              className="mb-[5px] block text-[11px] font-semibold uppercase tracking-[0.5px] text-[#5a626c]"
            >
              Name
            </label>
            <input
              id="harness-name"
              type="text"
              value={name}
              onChange={(e) => {
                if (e.target.value.length <= NAME_MAX_LENGTH) {
                  setName(e.target.value);
                }
                setNameError('');
              }}
              className="w-full rounded-[8px] border border-white/[0.07] bg-white/[0.03] px-[12px] py-[9px] text-[14px] text-[#f0f0f0] placeholder:text-[#5a626c] outline-none transition-colors focus:border-[#5e6ad2]/40 focus:bg-white/[0.05]"
              placeholder="Template name"
              maxLength={NAME_MAX_LENGTH}
              autoFocus
            />
            <div className="mt-[4px] flex items-center justify-between">
              {nameError ? (
                <p className="text-[12px] text-red-400">{nameError}</p>
              ) : (
                <span />
              )}
              <span className="text-[11px] text-[#5a626c]">
                {name.length}/{NAME_MAX_LENGTH}
              </span>
            </div>
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="harness-description"
              className="mb-[5px] block text-[11px] font-semibold uppercase tracking-[0.5px] text-[#5a626c]"
            >
              Description <span className="font-normal normal-case text-[#5a626c]">(optional)</span>
            </label>
            <textarea
              id="harness-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-[8px] border border-white/[0.07] bg-white/[0.02] px-[12px] py-[9px] text-[14px] text-[#f0f0f0] placeholder:text-[#5a626c] outline-none transition-colors focus:border-[#5e6ad2]/40 focus:bg-white/[0.04]"
              placeholder="Optional description"
            />
          </div>
        </div>

        {error && (
          <p className="mt-[14px] rounded-[6px] border border-red-500/30 bg-red-500/10 px-[12px] py-[8px] text-[13px] text-red-400">
            {error}
          </p>
        )}

        <div className="mt-[20px] flex justify-end gap-[10px]">
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-[9px] border border-white/[0.07] bg-white/[0.03] px-[16px] py-[8px] text-[13px] font-medium text-[#9aa3ad] backdrop-blur-md hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-[#e6e8eb] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="kb-sheen relative overflow-hidden rounded-[9px] bg-[#5e6ad2] px-[16px] py-[8px] text-[13px] font-bold text-white shadow-[0_4px_16px_-4px_rgba(94, 106, 210,0.5)] transition-all hover:bg-[#6e79de] hover:shadow-[0_6px_22px_-4px_rgba(94, 106, 210,0.65)] disabled:opacity-50"
          >
            {loading ? 'Saving...' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
