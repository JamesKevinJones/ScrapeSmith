import type {
  CellValue,
  ConfidenceLevel,
  CreativeStudioPayload,
  ExtractedRow,
  FieldDefinition,
  FieldType,
} from '../types';

export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const safeLimit = Math.max(1, Math.floor(limit));
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(safeLimit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

export function formatCellValue(value: CellValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

export function parseEditedCellValue(raw: string, type: FieldType): CellValue {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'null') {
    return null;
  }

  switch (type) {
    case 'number': {
      const cleaned = trimmed.replace(/[$,%\s,]/g, '');
      const num = Number(cleaned);
      return Number.isFinite(num) ? num : trimmed;
    }
    case 'boolean': {
      if (['true', 'yes', '1'].includes(trimmed.toLowerCase())) return true;
      if (['false', 'no', '0'].includes(trimmed.toLowerCase())) return false;
      return trimmed;
    }
    case 'list': {
      return trimmed
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    case 'url':
    case 'date':
    case 'string':
    default:
      return trimmed;
  }
}

export function dedupeRows(
  rows: ExtractedRow[],
  key: string
): { rows: ExtractedRow[]; removedCount: number } {
  const seen = new Set<string>();
  const kept: ExtractedRow[] = [];
  let removedCount = 0;

  for (const row of rows) {
    let fingerprint: string;

    if (key === '__all__') {
      const entries = Object.keys(row.values)
        .sort()
        .map((k) => `${k}=${formatCellValue(row.values[k]).trim().toLowerCase()}`);
      fingerprint = entries.join('|');
    } else if (key === '_sourceUrl') {
      fingerprint = row._sourceUrl.trim().toLowerCase();
    } else {
      const val = row.values[key];
      // Do not falsely collapse rows where the chosen key is null/empty
      if (val === null || val === undefined || formatCellValue(val).trim() === '') {
        kept.push(row);
        continue;
      }
      fingerprint = formatCellValue(val).trim().toLowerCase();
    }

    if (seen.has(fingerprint)) {
      removedCount += 1;
      continue;
    }
    seen.add(fingerprint);
    kept.push(row);
  }

  return { rows: kept, removedCount };
}

export interface RowFilterSortOptions {
  query: string;
  confidence: ConfidenceLevel | 'all';
  sortKey: string | null;
  sortDir: 'asc' | 'desc';
}

const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

export function filterAndSortRows(
  rows: ExtractedRow[],
  options: RowFilterSortOptions
): ExtractedRow[] {
  const q = options.query.trim().toLowerCase();

  let filtered = rows.filter((row) => {
    if (options.confidence !== 'all' && row.confidence !== options.confidence) {
      return false;
    }
    if (!q) return true;

    const haystack = [
      row._sourceUrl,
      row.confidence,
      row.source_snippet,
      row.notes ?? '',
      ...Object.values(row.values).map((v) => formatCellValue(v)),
    ]
      .join(' ')
      .toLowerCase();

    return haystack.includes(q);
  });

  if (options.sortKey) {
    const key = options.sortKey;
    const dir = options.sortDir === 'asc' ? 1 : -1;

    filtered = [...filtered].sort((a, b) => {
      if (key === 'confidence') {
        return (CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence]) * dir;
      }
      if (key === '_sourceUrl') {
        return a._sourceUrl.localeCompare(b._sourceUrl) * dir;
      }
      if (key === 'source_snippet') {
        return a.source_snippet.localeCompare(b.source_snippet) * dir;
      }

      const av = a.values[key];
      const bv = b.values[key];

      if (av === null || av === undefined) return bv === null || bv === undefined ? 0 : 1;
      if (bv === null || bv === undefined) return -1;

      if (typeof av === 'number' && typeof bv === 'number') {
        return (av - bv) * dir;
      }

      return formatCellValue(av).localeCompare(formatCellValue(bv), undefined, { numeric: true }) * dir;
    });
  }

  return filtered;
}

function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function exportToCsv(fields: FieldDefinition[], rows: ExtractedRow[]): string {
  const headers = [
    ...fields.map((f) => f.name),
    'confidence',
    'source_snippet',
    'source_url',
    'notes',
  ];

  const lines: string[] = [headers.map(escapeCsvCell).join(',')];

  for (const row of rows) {
    const cells = [
      ...fields.map((f) => formatCellValue(row.values[f.name])),
      row.confidence,
      row.source_snippet,
      row._sourceUrl,
      row.notes ?? '',
    ];
    lines.push(cells.map(escapeCsvCell).join(','));
  }

  return lines.join('\r\n');
}

export function rowToCleanObject(fields: FieldDefinition[], row: ExtractedRow): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const f of fields) {
    record[f.name] = row.values[f.name] ?? null;
  }
  record.confidence = row.confidence;
  record.source_snippet = row.source_snippet;
  record.source_url = row._sourceUrl;
  if (row.notes) {
    record.notes = row.notes;
  }
  return record;
}

export function buildCreativeStudioPayload(
  sourceUrls: string[],
  fields: FieldDefinition[],
  rows: ExtractedRow[],
  extractedAt = new Date().toISOString()
): CreativeStudioPayload {
  return {
    source_urls: Array.from(new Set(sourceUrls)),
    fields: fields.map((f) => ({
      name: f.name,
      type: f.type,
      ...(f.description ? { description: f.description } : {}),
    })),
    rows: rows.map((row) => rowToCleanObject(fields, row)),
    extracted_at: extractedAt,
  };
}

export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
