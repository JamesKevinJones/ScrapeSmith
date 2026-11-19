import type { HistoryRun } from '../types';

const STORAGE_KEY = 'scrapesmith_history_v1';
const MAX_HISTORY_RUNS = 25;

export function loadHistory(): HistoryRun[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is HistoryRun =>
        item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.createdAt === 'string' &&
        Array.isArray(item.urls) &&
        Array.isArray(item.fields) &&
        Array.isArray(item.rows)
    );
  } catch {
    return [];
  }
}

export function saveHistoryRun(run: HistoryRun): HistoryRun[] {
  const existing = loadHistory().filter((item) => item.id !== run.id);
  const updated = [run, ...existing].slice(0, MAX_HISTORY_RUNS);
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    }
  } catch {
    // Ignore storage quota or private browsing errors gracefully
  }
  return updated;
}

export function deleteHistoryRun(id: string): HistoryRun[] {
  const updated = loadHistory().filter((item) => item.id !== id);
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    }
  } catch {
    // Ignore storage errors
  }
  return updated;
}

export function clearHistory(): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}
