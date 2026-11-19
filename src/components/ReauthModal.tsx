import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  Lock,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import { verifySessionApi } from '../services/gemini';
import type { SessionAuthType, TemporarySession } from '../types';
import {
  buildSessionHeader,
  clearAllSessions,
  extractOrigin,
  formatRemainingTtl,
  listActiveSessions,
  revokeSession,
  saveTemporarySession,
} from '../utils/sessionStore';

interface ReauthModalProps {
  isOpen: boolean;
  targetUrl: string | null;
  targetTaskId: string | null;
  authHint?: string | null;
  onClose: () => void;
  onSessionsChanged: (sessions: TemporarySession[]) => void;
  onRetryAfterAuth?: (taskId: string) => void;
  onNotify: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}

const TTL_OPTIONS = [15, 30, 60];

export function ReauthModal({
  isOpen,
  targetUrl,
  targetTaskId,
  authHint,
  onClose,
  onSessionsChanged,
  onRetryAfterAuth,
  onNotify,
}: ReauthModalProps) {
  const [urlInput, setUrlInput] = useState(targetUrl ?? '');
  const [authType, setAuthType] = useState<SessionAuthType>('manual_relogin');
  const [loginUrl, setLoginUrl] = useState('');
  const [cookieOrToken, setCookieOrToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [ttlMinutes, setTtlMinutes] = useState(30);
  const [persistForTab, setPersistForTab] = useState(false);

  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyFeedback, setVerifyFeedback] = useState<{
    ok: boolean;
    message: string;
    status?: number;
  } | null>(null);

  const [activeSessions, setActiveSessions] = useState<TemporarySession[]>(() => listActiveSessions());
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    setUrlInput(targetUrl ?? '');
    const origin = targetUrl ? extractOrigin(targetUrl) : null;
    setLoginUrl(origin ? `${origin}/login` : '');
    setCookieOrToken('');
    setUsername('');
    setPassword('');
    setVerifyFeedback(null);
    setActiveSessions(listActiveSessions());
  }, [isOpen, targetUrl]);

  // Refresh TTL countdowns while modal is open
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => {
      const updated = listActiveSessions();
      setActiveSessions(updated);
      onSessionsChanged(updated);
      setTick((t) => t + 1);
    }, 5000);
    return () => clearInterval(interval);
  }, [isOpen, onSessionsChanged]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const resolvedOrigin = extractOrigin(urlInput);

  const buildCurrentHeader = () =>
    buildSessionHeader(authType, {
      cookieOrToken,
      username,
      password,
    });

  const handleVerifySession = async () => {
    const built = buildCurrentHeader();
    if (!resolvedOrigin || !urlInput.trim()) {
      setVerifyFeedback({ ok: false, message: 'Enter a valid target URL or domain first.' });
      return;
    }
    if (!built) {
      setVerifyFeedback({ ok: false, message: 'Provide session credentials or token before verifying.' });
      return;
    }

    setIsVerifying(true);
    setVerifyFeedback(null);
    try {
      const res = await verifySessionApi({
        url: urlInput.trim(),
        sessionAuth: { headerName: built.headerName, headerValue: built.headerValue },
      });
      setVerifyFeedback({ ok: res.ok, message: res.message, status: res.status });
    } catch (err) {
      setVerifyFeedback({
        ok: false,
        message: err instanceof Error ? err.message : 'Verification failed.',
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSaveSession = (triggerRetry: boolean) => {
    const built = buildCurrentHeader();
    if (!resolvedOrigin) {
      onNotify('error', 'Invalid URL', 'Enter a valid HTTP(S) target URL for this session.');
      return;
    }
    if (!built) {
      onNotify('error', 'Missing session credentials', 'Enter a session cookie, Bearer token, or Basic credentials.');
      return;
    }

    const saved = saveTemporarySession(
      {
        urlOrOrigin: urlInput.trim(),
        authType,
        headerName: built.headerName,
        headerValue: built.headerValue,
        maskedPreview: built.maskedPreview,
        loginUrl: authType === 'manual_relogin' ? loginUrl : undefined,
        ttlMinutes,
        verified: verifyFeedback?.ok,
        verifiedStatus: verifyFeedback?.status,
      },
      persistForTab
    );

    // Clear raw password / token inputs immediately after saving into ephemeral store
    setPassword('');
    setCookieOrToken('');

    if (!saved) {
      onNotify('error', 'Could not save session', 'Check the target URL format.');
      return;
    }

    const updated = listActiveSessions();
    setActiveSessions(updated);
    onSessionsChanged(updated);

    onNotify(
      'success',
      `Temporary session active for ${saved.origin}`,
      `Expires automatically in ${ttlMinutes} minutes.`
    );

    if (triggerRetry && targetTaskId && onRetryAfterAuth) {
      onClose();
      onRetryAfterAuth(targetTaskId);
    }
  };

  const handleRevoke = (origin: string) => {
    const updated = revokeSession(origin);
    setActiveSessions(updated);
    onSessionsChanged(updated);
    onNotify('info', 'Session revoked', `Cleared temporary credentials for ${origin}.`);
  };

  const handleClearAll = () => {
    clearAllSessions();
    setActiveSessions([]);
    onSessionsChanged([]);
    onNotify('info', 'All temporary sessions cleared');
  };

  const safeLoginHref = (() => {
    const candidate = loginUrl.trim() || targetUrl || '';
    return /^https?:\/\//i.test(candidate) ? candidate : null;
  })();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reauth-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
    >
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg border border-white/[0.12] bg-[#131519] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-white/[0.08] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <KeyRound className="h-4 w-4 text-[#60A5FA]" aria-hidden="true" />
            <h2 id="reauth-modal-title" className="text-sm font-semibold text-[#F3F4F6]">
              Session Re-Authentication
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close session re-authentication modal"
            onClick={onClose}
            className="rounded p-1 text-[#9CA3AF] hover:bg-white/[0.08] hover:text-white transition-colors"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Context Banner if triggered from an auth_required URL */}
          {authHint && (
            <div
              role="status"
              className="rounded-md border border-amber-500/30 bg-amber-500/[0.08] p-3 text-xs text-amber-200 flex items-start gap-2.5"
            >
              <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="font-medium text-amber-300">Site requires fresh authentication</p>
                <p className="mt-0.5 text-amber-200/90 leading-relaxed">{authHint}</p>
              </div>
            </div>
          )}

          {/* Target URL */}
          <div className="space-y-1.5">
            <label htmlFor="reauth-target-url" className="block text-xs font-medium text-[#D1D5DB]">
              Target URL (session applies to this site origin)
            </label>
            <input
              id="reauth-target-url"
              type="url"
              value={urlInput}
              onChange={(e) => {
                setUrlInput(e.target.value);
                const nextOrigin = extractOrigin(e.target.value);
                if (nextOrigin && !loginUrl) setLoginUrl(`${nextOrigin}/login`);
              }}
              placeholder="https://portal.example.com/reports"
              className="w-full rounded-md border border-white/[0.1] bg-[#0B0C0E] px-3 py-2 font-mono text-xs text-[#E6E8EC] placeholder:text-[#6B7280] focus:border-[#3B82F6] focus:outline-none focus:ring-1 focus:ring-[#3B82F6]"
            />
            {resolvedOrigin && (
              <p className="text-[11px] text-[#9CA3AF] font-mono">
                Scope origin: {resolvedOrigin}
              </p>
            )}
          </div>

          {/* Auth Method Segmented Switcher */}
          <div className="space-y-2">
            <span className="block text-xs font-medium text-[#D1D5DB]">Authentication Method</span>
            <div
              role="tablist"
              aria-label="Re-authentication method"
              className="grid grid-cols-1 sm:grid-cols-3 gap-1 rounded-md border border-white/[0.08] bg-[#0B0C0E] p-1"
            >
              {[
                { id: 'manual_relogin' as const, label: 'Manual Re-Login' },
                { id: 'session_cookie' as const, label: 'Cookie / Bearer' },
                { id: 'basic_credentials' as const, label: 'HTTP Basic' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={authType === tab.id || (tab.id === 'session_cookie' && authType === 'bearer_token')}
                  onClick={() => {
                    setAuthType(tab.id);
                    setVerifyFeedback(null);
                  }}
                  className={`rounded px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                    authType === tab.id || (tab.id === 'session_cookie' && authType === 'bearer_token')
                      ? 'bg-[#1F242E] text-[#F3F4F6]'
                      : 'text-[#9CA3AF] hover:text-[#E6E8EC]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Method 1: Guided Manual Re-Login */}
          {authType === 'manual_relogin' && (
            <div className="space-y-3 rounded-md border border-white/[0.08] bg-[#0B0C0E] p-4">
              <ol className="space-y-2 text-xs text-[#D1D5DB] list-decimal list-inside">
                <li>
                  Open the site&apos;s login page in a browser tab and complete sign-in (including MFA or SSO).
                </li>
                <li>
                  Copy the refreshed <code className="text-[#93C5FD]">Cookie</code> or{' '}
                  <code className="text-[#93C5FD]">Authorization</code> header from browser DevTools Network tab.
                </li>
                <li>Paste it below, click <span className="font-medium text-white">Verify Session</span>, and retry extraction.</li>
              </ol>

              <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 pt-1">
                <input
                  type="url"
                  aria-label="Site login page URL"
                  value={loginUrl}
                  onChange={(e) => setLoginUrl(e.target.value)}
                  placeholder="https://portal.example.com/login"
                  className="min-w-0 flex-1 rounded-md border border-white/[0.1] bg-[#131519] px-3 py-1.5 font-mono text-xs text-[#E6E8EC] focus:border-[#3B82F6] focus:outline-none"
                />
                {safeLoginHref ? (
                  <a
                    href={safeLoginHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#3B82F6]/40 bg-[#3B82F6]/15 px-3 text-xs font-medium text-[#93C5FD] hover:bg-[#3B82F6]/25 transition-colors whitespace-nowrap shrink-0"
                  >
                    <span>Open Login Page</span>
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                ) : (
                  <span className="text-xs text-[#6B7280] whitespace-nowrap">Enter login URL</span>
                )}
              </div>

              <div className="space-y-1.5 pt-1">
                <label htmlFor="manual-session-header" className="block text-xs font-medium text-[#D1D5DB]">
                  Refreshed Cookie or Authorization Header
                </label>
                <textarea
                  id="manual-session-header"
                  rows={2}
                  value={cookieOrToken}
                  onChange={(e) => setCookieOrToken(e.target.value)}
                  placeholder="session_id=abc123; csrftoken=xyz...  OR  Authorization: Bearer eyJhbG..."
                  className="w-full rounded-md border border-white/[0.1] bg-[#131519] px-3 py-2 font-mono text-xs text-[#E6E8EC] placeholder:text-[#6B7280] focus:border-[#3B82F6] focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* Method 2: Session Cookie or Bearer Token */}
          {(authType === 'session_cookie' || authType === 'bearer_token') && (
            <div className="space-y-3 rounded-md border border-white/[0.08] bg-[#0B0C0E] p-4">
              <div className="flex items-center gap-4 text-xs">
                <label className="inline-flex items-center gap-2 text-[#D1D5DB] cursor-pointer">
                  <input
                    type="radio"
                    name="token-kind"
                    checked={authType === 'session_cookie'}
                    onChange={() => setAuthType('session_cookie')}
                    className="accent-[#3B82F6]"
                  />
                  <span>Session Cookie</span>
                </label>
                <label className="inline-flex items-center gap-2 text-[#D1D5DB] cursor-pointer">
                  <input
                    type="radio"
                    name="token-kind"
                    checked={authType === 'bearer_token'}
                    onChange={() => setAuthType('bearer_token')}
                    className="accent-[#3B82F6]"
                  />
                  <span>Bearer Token</span>
                </label>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="direct-session-input" className="block text-xs font-medium text-[#D1D5DB]">
                  {authType === 'bearer_token' ? 'Bearer Access Token' : 'Cookie Header Value'}
                </label>
                <textarea
                  id="direct-session-input"
                  rows={2}
                  value={cookieOrToken}
                  onChange={(e) => setCookieOrToken(e.target.value)}
                  placeholder={
                    authType === 'bearer_token'
                      ? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
                      : 'session_id=...; auth_token=...'
                  }
                  className="w-full rounded-md border border-white/[0.1] bg-[#131519] px-3 py-2 font-mono text-xs text-[#E6E8EC] placeholder:text-[#6B7280] focus:border-[#3B82F6] focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* Method 3: HTTP Basic Credentials */}
          {authType === 'basic_credentials' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-md border border-white/[0.08] bg-[#0B0C0E] p-4">
              <div className="space-y-1.5">
                <label htmlFor="basic-username" className="block text-xs font-medium text-[#D1D5DB]">
                  Username
                </label>
                <input
                  id="basic-username"
                  type="text"
                  autoComplete="off"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="account_user"
                  className="w-full rounded-md border border-white/[0.1] bg-[#131519] px-3 py-2 text-xs text-[#E6E8EC] focus:border-[#3B82F6] focus:outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="basic-password" className="block text-xs font-medium text-[#D1D5DB]">
                  Password / API Secret
                </label>
                <input
                  id="basic-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full rounded-md border border-white/[0.1] bg-[#131519] px-3 py-2 text-xs text-[#E6E8EC] focus:border-[#3B82F6] focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* Session Lifetime & Storage Scope */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <label htmlFor="session-ttl" className="text-[#9CA3AF]">
                Auto-expire after:
              </label>
              <select
                id="session-ttl"
                value={ttlMinutes}
                onChange={(e) => setTtlMinutes(Number(e.target.value))}
                className="rounded-md border border-white/[0.1] bg-[#0B0C0E] px-2.5 py-1 text-xs text-[#E6E8EC] focus:border-[#3B82F6] focus:outline-none"
              >
                {TTL_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m} minutes
                  </option>
                ))}
              </select>
            </div>

            <label className="inline-flex items-center gap-2 text-[#9CA3AF] cursor-pointer">
              <input
                type="checkbox"
                checked={persistForTab}
                onChange={(e) => setPersistForTab(e.target.checked)}
                className="rounded accent-[#3B82F6]"
              />
              <span>Keep across page refresh (this tab only)</span>
            </label>
          </div>

          {/* Live Session Verification Feedback */}
          {verifyFeedback && (
            <div
              role="status"
              className={`rounded-md border px-3.5 py-2.5 text-xs flex items-center gap-2 ${
                verifyFeedback.ok
                  ? 'border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-300'
                  : 'border-rose-500/30 bg-rose-500/[0.08] text-rose-300'
              }`}
            >
              {verifyFeedback.ok ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              <span>{verifyFeedback.message}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={handleVerifySession}
              disabled={isVerifying || !resolvedOrigin}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-white/[0.12] bg-[#1A1D23] px-3.5 text-xs font-medium text-[#E6E8EC] hover:bg-[#232730] disabled:opacity-40 transition-colors"
            >
              {isVerifying && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              <span>{isVerifying ? 'Verifying…' : 'Verify Session'}</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded-md border border-white/[0.1] px-3.5 text-xs font-medium text-[#9CA3AF] hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleSaveSession(Boolean(targetTaskId))}
                disabled={!resolvedOrigin}
                className="h-9 rounded-md bg-[#3B82F6] px-4 text-xs font-medium text-white hover:bg-[#2563EB] disabled:opacity-40 transition-colors"
              >
                {targetTaskId ? 'Save Session & Retry URL' : 'Save Temporary Session'}
              </button>
            </div>
          </div>

          {/* Security Policy Note */}
          <div className="rounded-md border border-white/[0.07] bg-[#0B0C0E]/80 p-3 text-[11px] leading-relaxed text-[#9CA3AF] flex items-start gap-2">
            <Lock className="h-3.5 w-3.5 shrink-0 text-[#60A5FA] mt-0.5" aria-hidden="true" />
            <p>
              Temporary session headers stay in volatile memory (never written to localStorage or run
              history), expire automatically, and are transmitted only to the matched target origin.
              Use solely for websites and accounts you are authorized to access.
            </p>
          </div>

          {/* Active Temporary Sessions List */}
          {activeSessions.length > 0 && (
            <div className="space-y-2 border-t border-white/[0.08] pt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-[#D1D5DB]">
                  Active Temporary Sessions ({activeSessions.length})
                </h3>
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="text-xs text-[#9CA3AF] hover:text-rose-400 transition-colors"
                >
                  Revoke All
                </button>
              </div>
              <ul className="divide-y divide-white/[0.06] rounded-md border border-white/[0.08] bg-[#0B0C0E]">
                {activeSessions.map((session) => (
                  <li
                    key={session.origin}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-xs"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-mono text-[#E6E8EC] truncate">{session.origin}</p>
                      <p className="text-[11px] text-[#9CA3AF] tabular-nums">
                        {session.maskedPreview} · {formatRemainingTtl(session.expiresAt)}
                        {session.verified ? ' · Verified' : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`Revoke session for ${session.origin}`}
                      onClick={() => handleRevoke(session.origin)}
                      className="inline-flex items-center gap-1 rounded border border-white/[0.08] px-2 py-1 text-[11px] text-[#9CA3AF] hover:border-rose-500/35 hover:text-rose-400 transition-colors"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden="true" />
                      <span>Revoke</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
