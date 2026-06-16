import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AlfLogo } from '../components/layout/Sidebar';

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M2.25 9s2.25-4.5 6.75-4.5S15.75 9 15.75 9s-2.25 4.5-6.75 4.5S2.25 9 2.25 9z"
        stroke="#667"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="9"
        cy="9"
        r="2.25"
        stroke="#667"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M6.75 4.125C7.47 3.885 8.22 3.75 9 3.75c4.5 0 6.75 4.5 6.75 4.5-.45.9-1.26 2.145-2.535 3.105M4.32 5.865C3.09 6.99 2.25 8.25 2.25 9s2.25 4.5 6.75 4.5c.96 0 1.845-.18 2.625-.495M3.75 2.25l10.5 13.5M10.5 7.5a2.25 2.25 0 01-3 3"
        stroke="#667"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 11 11"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="opacity-70"
    >
      <rect x="2.5" y="5" width="6" height="4.5" rx="1" stroke="#5a626c" strokeWidth="1" />
      <path d="M3.5 5V3.5a2 2 0 014 0V5" stroke="#5a626c" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M5.5 4l4 4-4 4"
        stroke="#0a0a0f"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function LoginPage() {
  const { isAuthenticated, isLoading, login } = useAuth();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Already authenticated — redirect to dashboard
  if (!isLoading && isAuthenticated) {
    return <Navigate to="/projects" replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;

    setError('');
    setIsSubmitting(true);

    const result = await login(password);

    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error);
    }
    // On success, AuthContext sets isAuthenticated=true, triggering redirect
  };

  const isDisabled = !password.trim() || isSubmitting || isLoading;

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[#0a0a0f] px-4">
      {/* Background radial gradients */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(ellipse at 50% 40%, rgba(30,30,60,0.5) 0%, transparent 70%), radial-gradient(ellipse at 50% 30%, rgba(179,229,2,0.04) 0%, transparent 60%)',
        }}
      />

      {/* Subtle grid overlay */}
      <div
        className="absolute inset-0 opacity-[0.016]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
        }}
      />

      <div className="relative flex w-full max-w-[420px] flex-col items-center gap-8">
        {/* Banner */}
        <div className="flex items-center gap-3">
          <AlfLogo size={32} />
          <span className="flex items-baseline gap-[5px] font-['Syne'] text-[20px] font-extrabold tracking-[-0.5px]">
            <span className="text-[#f2f3f5]">ALF</span>
            <span className="text-[#b3e502]">code</span>
          </span>
        </div>

        {/* Main Card */}
        <div
          className="w-full max-w-[333px] border border-white/[0.07] bg-[#111118] p-px"
          style={{
            borderRadius: '2px',
            boxShadow:
              '0 0 0 1px rgba(179,229,2,0.08), 0 24px 64px rgba(0,0,0,0.6), 0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          {/* Green gradient top line */}
          <div
            className="h-px w-full"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, rgb(170,255,0) 30%, rgba(179,229,2,0.4) 60%, transparent 100%)',
            }}
          />

          <div className="px-10 py-10">
            {/* Header */}
            <div className="mb-4">
              <h1 className="font-['Inter'] text-[24px] font-semibold leading-[28.8px] tracking-[-0.6px] text-[#f0f0f0]">
                Welcome back
              </h1>
              <p className="font-['Inter'] text-[14px] font-normal leading-[21px] text-[#9aa3ad]">
                Your VPS sessions, under control.
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="password"
                  className="font-['Inter'] text-[14px] font-medium leading-[21px] tracking-[0.14px] text-[#9aa3ad]"
                >
                  Master Password
                </label>
                <div className="relative mt-2">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setError('');
                    }}
                    placeholder={showPassword ? 'Enter your password' : '••••••••••••'}
                    autoFocus
                    autoComplete="current-password"
                    className="w-full border border-white/[0.07] bg-[rgba(255,255,255,0.03)] px-4 py-2.5 font-['JetBrains_Mono'] text-[14px] tracking-[0.7px] text-[#ccd] placeholder-[#556] outline-none transition-colors focus:border-[rgba(179,229,2,0.3)]"
                    style={{ borderRadius: '2px', paddingRight: '44px' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-0 top-0 flex h-[44px] w-[44px] items-center justify-center rounded-br-[2px] rounded-tr-[2px] hover:bg-[rgba(255,255,255,0.03)]"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
              </div>

              {/* Error message */}
              {error && (
                <p className="font-['Inter'] text-[13px] text-red-400" role="alert">
                  {error}
                </p>
              )}

              {/* Sign In button */}
              <button
                type="submit"
                disabled={isDisabled}
                className="relative flex w-full items-center justify-center overflow-hidden bg-[#b3e502] py-[13.5px] font-['Inter'] text-[14px] font-semibold tracking-[0.28px] text-[#0a0a0f] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                style={{ borderRadius: '2px' }}
              >
                {/* Shine effect */}
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      'linear-gradient(147deg, transparent 41%, rgba(255,255,255,0.25) 50%, transparent 58%)',
                  }}
                />
                <span className="relative flex items-center gap-1">
                  {isSubmitting ? 'Signing in...' : 'Sign in'}
                  {!isSubmitting && <ArrowIcon />}
                </span>
              </button>
            </form>

            {/* Footer */}
            <div className="mt-5 border-t border-white/[0.07] pt-5">
              <div className="flex items-center gap-[7px]">
                <LockIcon />
                <span className="font-['JetBrains_Mono'] text-[11px] font-normal leading-[16.5px] tracking-[0.22px] text-[#5a626c]">
                  Single user access
                </span>
                <span className="mx-0.5 h-[3px] w-[3px] rounded-[1.5px] bg-[#556]" />
                <span className="font-['JetBrains_Mono'] text-[11px] font-normal leading-[16.5px] tracking-[0.22px] text-[#5a626c]">
                  JWT secured
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Version */}
        <p className="font-['JetBrains_Mono'] text-[11px] font-normal leading-[16.5px] tracking-[0.44px] text-[#5a626c] opacity-60">
          v0.1.0
        </p>
      </div>
    </div>
  );
}
