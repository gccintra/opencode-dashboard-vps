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
        className="mx-4 w-full max-w-[420px] rounded-[12px] border border-[rgba(255,255,255,0.08)] bg-[#111118] p-[24px]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-['Inter'] text-[16px] font-semibold text-[#f0f0f0]">{title}</h3>

        <div className="mt-[18px] space-y-[14px]">
          {/* Name */}
          <div>
            <label
              htmlFor="harness-name"
              className="mb-[5px] block font-['Inter'] text-[11px] font-semibold uppercase tracking-[0.5px] text-[#445]"
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
              className="w-full rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[#0a0a0f] px-[12px] py-[9px] font-['Inter'] text-[14px] text-[#f0f0f0] placeholder:text-[#445] outline-none focus:border-[rgba(255,255,255,0.16)]"
              placeholder="Template name"
              maxLength={NAME_MAX_LENGTH}
              autoFocus
            />
            <div className="mt-[4px] flex items-center justify-between">
              {nameError ? (
                <p className="font-['Inter'] text-[12px] text-red-400">{nameError}</p>
              ) : (
                <span />
              )}
              <span className="font-['Inter'] text-[11px] text-[#445]">
                {name.length}/{NAME_MAX_LENGTH}
              </span>
            </div>
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="harness-description"
              className="mb-[5px] block font-['Inter'] text-[11px] font-semibold uppercase tracking-[0.5px] text-[#445]"
            >
              Description{' '}
              <span className="font-normal normal-case text-[#556]">(optional)</span>
            </label>
            <textarea
              id="harness-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[#0a0a0f] px-[12px] py-[9px] font-['Inter'] text-[14px] text-[#f0f0f0] placeholder:text-[#445] outline-none focus:border-[rgba(255,255,255,0.16)]"
              placeholder="Optional description"
            />
          </div>
        </div>

        {error && (
          <p className="mt-[14px] rounded-[6px] border border-red-500/30 bg-red-500/10 px-[12px] py-[8px] font-['Inter'] text-[13px] text-red-400">
            {error}
          </p>
        )}

        <div className="mt-[20px] flex justify-end gap-[10px]">
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-[6px] border border-[rgba(255,255,255,0.08)] px-[16px] py-[8px] font-['Inter'] text-[13px] font-medium text-[#889] hover:border-[rgba(255,255,255,0.16)] hover:text-[#ccd] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="rounded-[6px] bg-[#af0] px-[16px] py-[8px] font-['Inter'] text-[13px] font-semibold text-[#0a0a0f] hover:bg-[#9e0] transition-colors disabled:opacity-50"
          >
            {loading ? 'Saving...' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
