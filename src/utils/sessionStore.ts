import type { SessionAuthType, SessionHeaderPayload, TemporarySession } from '../types';

const EPHEMERAL_STORAGE_KEY = 'scrapesmith_ephemeral_sessions_v1';

// Primary storage is strictly in-memory so credentials never touch localStorage.
const memorySessions = new Map<string, TemporarySession>();

export function extractOrigin(urlStr: string): string | null {
  try {
    const parsed = new URL(/^https?:\/\//i.test(urlStr) ? urlStr : `https://${urlStr}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin.toLowerCase();
  } catch {
    return null;
  }
}

export function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 6) return '••••••';
  return `${trimmed.slice(0, 3)}••••••${trimmed.slice(-4)}`;
}

export function encodeBasicAuthHeader(username: string, password: string): string {
  const raw = `${username}:${password}`;
  if (typeof btoa === 'function') {
    const bytes = new TextEncoder().encode(raw);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return `Basic ${btoa(binary)}`;
  }
  return `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`;
}

export function buildSessionHeader(
  authType: SessionAuthType,
  params: { cookieOrToken?: string; username?: string; password?: string }
): { headerName: 'Cookie' | 'Authorization'; headerValue: string; maskedPreview: string } | null {
  if (authType === 'basic_credentials') {
    const user = (params.username ?? '').trim();
    const pass = params.password ?? '';
    if (!user || !pass) return null;
    const headerValue = encodeBasicAuthHeader(user, pass);
    return {
      headerName: 'Authorization',
      headerValue,
      maskedPreview: `Basic (${user}:••••••)`,
    };
  }

  const raw = (params.cookieOrToken ?? '').trim();
  if (!raw) return null;

  if (authType === 'bearer_token') {
    const token = /^bearer\s+/i.test(raw) ? raw : `Bearer ${raw}`;
    return {
      headerName: 'Authorization',
      headerValue: token,
      maskedPreview: `Bearer ${maskSecret(token.replace(/^bearer\s+/i, ''))}`,
    };
  }

  // session_cookie or manual_relogin (accepts either raw Cookie header or "Authorization: Bearer ...")
  if (/^authorization:\s*/i.test(raw)) {
    const val = raw.replace(/^authorization:\s*/i, '').trim();
    return {
      headerName: 'Authorization',
      headerValue: val,
      maskedPreview: maskSecret(val),
    };
  }

  const cookieVal = raw.replace(/^cookie:\s*/i, '').trim();
  return {
    headerName: 'Cookie',
    headerValue: cookieVal,
    maskedPreview: `Cookie (${maskSecret(cookieVal)})`,
  };
}

function purgeExpired(now = Date.now()): void {
  for (const [origin, session] of memorySessions.entries()) {
    if (session.expiresAt <= now) {
      memorySessions.delete(origin);
    }
  }
}

function syncToTabSessionStorage(persistForTab: boolean): void {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    if (!persistForTab) {
      window.sessionStorage.removeItem(EPHEMERAL_STORAGE_KEY);
      return;
    }
    purgeExpired();
    const list = Array.from(memorySessions.values());
    window.sessionStorage.setItem(EPHEMERAL_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Ignore storage unavailability
  }
}

export function hydrateTabSessions(): TemporarySession[] {
  const now = Date.now();
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const raw = window.sessionStorage.getItem(EPHEMERAL_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (
              item &&
              typeof item.origin === 'string' &&
              typeof item.headerValue === 'string' &&
              typeof item.expiresAt === 'number' &&
              item.expiresAt > now
            ) {
              memorySessions.set(item.origin.toLowerCase(), item as TemporarySession);
            }
          }
        }
      }
    }
  } catch {
    // Ignore malformed sessionStorage
  }
  purgeExpired(now);
  return listActiveSessions(now);
}

export function saveTemporarySession(
  input: {
    urlOrOrigin: string;
    authType: SessionAuthType;
    headerName: 'Cookie' | 'Authorization';
    headerValue: string;
    maskedPreview: string;
    loginUrl?: string;
    ttlMinutes: number;
    verified?: boolean;
    verifiedStatus?: number;
  },
  persistForTab = false,
  now = Date.now()
): TemporarySession | null {
  const origin = extractOrigin(input.urlOrOrigin);
  if (!origin) return null;

  const ttlMs = Math.max(1, Math.min(180, input.ttlMinutes)) * 60_000;
  const session: TemporarySession = {
    origin,
    authType: input.authType,
    headerName: input.headerName,
    headerValue: input.headerValue,
    maskedPreview: input.maskedPreview,
    loginUrl: input.loginUrl?.trim() || undefined,
    createdAt: now,
    expiresAt: now + ttlMs,
    verified: input.verified,
    verifiedStatus: input.verifiedStatus,
  };

  memorySessions.set(origin, session);
  if (persistForTab) {
    syncToTabSessionStorage(true);
  }
  return session;
}

export function getSessionForUrl(url: string, now = Date.now()): TemporarySession | null {
  purgeExpired(now);
  const origin = extractOrigin(url);
  if (!origin) return null;
  const session = memorySessions.get(origin);
  if (!session || session.expiresAt <= now) {
    memorySessions.delete(origin);
    return null;
  }
  return session;
}

export function getSessionHeaderForUrl(url: string, now = Date.now()): SessionHeaderPayload | null {
  const session = getSessionForUrl(url, now);
  if (!session) return null;
  return {
    headerName: session.headerName,
    headerValue: session.headerValue,
  };
}

export function listActiveSessions(now = Date.now()): TemporarySession[] {
  purgeExpired(now);
  return Array.from(memorySessions.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function revokeSession(origin: string): TemporarySession[] {
  memorySessions.delete(origin.toLowerCase());
  try {
    if (typeof window !== 'undefined' && window.sessionStorage && window.sessionStorage.getItem(EPHEMERAL_STORAGE_KEY)) {
      syncToTabSessionStorage(true);
    }
  } catch {
    // Ignore
  }
  return listActiveSessions();
}

export function clearAllSessions(): void {
  memorySessions.clear();
  syncToTabSessionStorage(false);
}

export function formatRemainingTtl(expiresAt: number, now = Date.now()): string {
  const diffSec = Math.max(0, Math.floor((expiresAt - now) / 1000));
  if (diffSec === 0) return 'Expired';
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  if (mins >= 1) return `${mins}m ${secs.toString().padStart(2, '0')}s left`;
  return `${secs}s left`;
}
