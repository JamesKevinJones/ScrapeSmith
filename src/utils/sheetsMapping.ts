import type { ExtractedRow, FieldDefinition, SheetColumnMapping } from '../types';
import { formatCellValue } from './dataTransforms';

export function indexToColumnLetter(index: number): string {
  let n = index;
  let result = '';
  while (n >= 0) {
    result = String.fromCharCode((n % 26) + 65) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}

export function humanizeHeader(fieldName: string): string {
  return fieldName
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function createDefaultSheetMappings(fields: FieldDefinition[]): SheetColumnMapping[] {
  const fieldMappings: SheetColumnMapping[] = fields.map((f) => ({
    sourceKey: f.name,
    label: f.name,
    sheetHeader: humanizeHeader(f.name),
    included: true,
    isMeta: false,
  }));

  const metaMappings: SheetColumnMapping[] = [
    {
      sourceKey: '__confidence',
      label: 'confidence',
      sheetHeader: 'Confidence',
      included: true,
      isMeta: true,
    },
    {
      sourceKey: '__source_snippet',
      label: 'source_snippet',
      sheetHeader: 'Source Snippet',
      included: true,
      isMeta: true,
    },
    {
      sourceKey: '__source_url',
      label: 'source_url',
      sheetHeader: 'Source URL',
      included: true,
      isMeta: true,
    },
    {
      sourceKey: '__notes',
      label: 'notes',
      sheetHeader: 'Notes',
      included: false,
      isMeta: true,
    },
  ];

  return [...fieldMappings, ...metaMappings];
}

export function buildSheetValuesMatrix(
  mappings: SheetColumnMapping[],
  rows: ExtractedRow[],
  includeHeaders: boolean
): Array<Array<string | number | boolean>> {
  const activeMappings = mappings.filter((m) => m.included);
  if (activeMappings.length === 0) return [];

  const matrix: Array<Array<string | number | boolean>> = [];

  if (includeHeaders) {
    matrix.push(activeMappings.map((m) => m.sheetHeader.trim() || m.label));
  }

  for (const row of rows) {
    const sheetRow: Array<string | number | boolean> = activeMappings.map((m) => {
      if (m.sourceKey === '__confidence') return row.confidence;
      if (m.sourceKey === '__source_snippet') return row.source_snippet;
      if (m.sourceKey === '__source_url') return row._sourceUrl;
      if (m.sourceKey === '__notes') return row.notes ?? '';

      const val = row.values[m.sourceKey];
      if (val === null || val === undefined) return '';
      if (typeof val === 'number' || typeof val === 'boolean') return val;
      return formatCellValue(val);
    });
    matrix.push(sheetRow);
  }

  return matrix;
}

export function extractSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  return trimmed;
}
