import type { ParsedTargetInput } from '../types';

export const MAX_URLS = 10;

const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^\[::1\]$/,
  /\.local$/i,
  /\.internal$/i,
];

function isBlockedHostname(hostname: string): boolean {
  return BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}

function looksLikeDomainOrUrl(line: string): boolean {
  if (/^https?:\/\//i.test(line)) return true;
  // Bare domain without spaces, containing a valid-looking TLD dot (e.g. docs.python.org/3/)
  if (!/\s/.test(line) && /^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(line)) {
    return true;
  }
  return false;
}

export function normalizeUrl(rawLine: string): string | null {
  const trimmed = rawLine.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (!parsed.hostname || !parsed.hostname.includes('.')) {
      return null;
    }
    if (isBlockedHostname(parsed.hostname)) {
      return null;
    }
    // Strip hash fragments to improve deduplication of identical pages
    parsed.hash = '';
    let normalized = parsed.toString();
    if (parsed.pathname === '/' && !parsed.search && normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    return null;
  }
}

export function parseTargetInput(raw: string): ParsedTargetInput {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return {
      inputKind: 'empty',
      validUrls: [],
      duplicateCount: 0,
      overflowCount: 0,
      invalidEntries: [],
      topicQuery: null,
    };
  }

  // Single non-URL descriptive phrase triggers topic discovery via Google Search
  if (lines.length === 1 && !looksLikeDomainOrUrl(lines[0]) && !/^[a-z]+:\/\//i.test(lines[0])) {
    return {
      inputKind: 'topic',
      validUrls: [],
      duplicateCount: 0,
      overflowCount: 0,
      invalidEntries: [],
      topicQuery: lines[0],
    };
  }

  const seen = new Set<string>();
  const validUrls: string[] = [];
  const invalidEntries: string[] = [];
  let duplicateCount = 0;
  let overflowCount = 0;

  for (const line of lines) {
    const normalized = normalizeUrl(line);
    if (!normalized) {
      invalidEntries.push(line);
      continue;
    }

    const dedupeKey = normalized.toLowerCase();
    if (seen.has(dedupeKey)) {
      duplicateCount += 1;
      continue;
    }

    seen.add(dedupeKey);
    if (validUrls.length < MAX_URLS) {
      validUrls.push(normalized);
    } else {
      overflowCount += 1;
    }
  }

  return {
    inputKind: 'urls',
    validUrls,
    duplicateCount,
    overflowCount,
    invalidEntries,
    topicQuery: null,
  };
}
