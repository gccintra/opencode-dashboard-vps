import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AlfLogo } from '../components/layout/Sidebar';
import { Button } from '../components/ui';

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M2.25 9s2.25-4.5 6.75-4.5S15.75 9 15.75 9s-2.25 4.5-6.75 4.5S2.25 9 2.25 9z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="9"
        cy="9"
        r="2.25"
        stroke="currentColor"
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
        stroke="currentColor"
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
      <rect x="2.5" y="5" width="6" height="4.5" rx="1" stroke="currentColor" strokeWidth="1" />
      <path d="M3.5 5V3.5a2 2 0 014 0V5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M5.5 4l4 4-4 4"
        stroke="currentColor"
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
    <div className="app-vignette relative flex min-h-screen items-center justify-center px-4">
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
          <span className="text-[20px] font-extrabold tracking-[-0.4px] text-ink">ALF</span>
        </div>

        {/* Main Card */}
        <div
          className="w-full max-w-[333px] overflow-hidden rounded-modal border border-hairline bg-surface"
          style={{
            boxShadow:
              '0 0 0 1px rgba(94, 106, 210,0.08), 0 24px 64px rgba(0,0,0,0.6), 0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          {/* Green gradient top line */}
          <div
            className="h-px w-full"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, rgb(94, 106, 210) 30%, rgba(94, 106, 210,0.4) 60%, transparent 100%)',
            }}
          />

          <div className="px-10 py-10">
            {/* Header */}
            <div className="mb-4">
              <h1 className="text-[24px] font-semibold leading-[28.8px] tracking-[-0.6px] text-ink">
                Welcome back
              </h1>
              <p className="text-[14px] font-normal leading-[21px] text-ink-2">
                Your VPS sessions, under control.
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="password"
                  className="text-[14px] font-medium leading-[21px] tracking-[0.14px] text-ink-2"
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
                    className="w-full rounded-control border border-hairline bg-surface-2 px-4 py-2.5 pr-[44px] font-['JetBrains_Mono'] text-[14px] tracking-[0.7px] text-ink placeholder-ink-4 outline-none transition-colors focus:border-accent/30"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-0 top-0 flex h-full w-[44px] items-center justify-center rounded-r-control text-ink-3 transition-colors hover:text-ink-2"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
              </div>

              {/* Error message */}
              {error && (
                <p
                  className="rounded-control border border-danger/30 bg-danger/10 px-[12px] py-[8px] text-[13px] text-danger"
                  role="alert"
                >
                  {error}
                </p>
              )}

              {/* Sign In button */}
              <Button
                type="submit"
                variant="primary"
                disabled={isDisabled}
                className="w-full justify-center py-[12px]"
              >
                {isSubmitting ? 'Signing in…' : 'Sign in'}
                {!isSubmitting && <ArrowIcon />}
              </Button>
            </form>

            {/* Footer */}
            <div className="mt-5 border-t border-hairline pt-5">
              <div className="flex items-center gap-[7px] text-ink-3">
                <LockIcon />
                <span className="font-['JetBrains_Mono'] text-[11px] font-normal leading-[16.5px] tracking-[0.22px]">
                  Single user access
                </span>
                <span className="mx-0.5 size-[3px] rounded-full bg-ink-4" />
                <span className="font-['JetBrains_Mono'] text-[11px] font-normal leading-[16.5px] tracking-[0.22px]">
                  JWT secured
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Version */}
        <p className="font-['JetBrains_Mono'] text-[11px] font-normal leading-[16.5px] tracking-[0.44px] text-ink-4">
          v0.1.0
        </p>
      </div>
    </div>
  );
}
