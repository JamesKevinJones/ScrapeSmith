import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExtractedRow, FieldDefinition } from '../types';
import {
  buildCreativeStudioPayload,
  dedupeRows,
  exportToCsv,
  filterAndSortRows,
  parseEditedCellValue,
  runWithConcurrency,
} from './dataTransforms';

const SAMPLE_FIELDS: FieldDefinition[] = [
  { id: '1', name: 'title', type: 'string' },
  { id: '2', name: 'price', type: 'number' },
  { id: '3', name: 'tags', type: 'list' },
];

const SAMPLE_ROWS: ExtractedRow[] = [
  {
    _id: 'r1',
    _sourceUrl: 'https://books.example/1',
    confidence: 'high',
    source_snippet: 'Alpha Book - $19.99',
    notes: 'USD',
    values: { title: 'Alpha, "Special"', price: 19.99, tags: ['sci-fi', 'new'] },
  },
  {
    _id: 'r2',
    _sourceUrl: 'https://books.example/2',
    confidence: 'medium',
    source_snippet: 'Beta Book - $9.50',
    notes: 'USD',
    values: { title: 'Beta Book', price: 9.5, tags: ['history'] },
  },
  {
    _id: 'r3',
    _sourceUrl: 'https://books.example/3',
    confidence: 'low',
    source_snippet: 'Duplicate Alpha',
    values: { title: 'alpha, "special"', price: 21.0, tags: null },
  },
];

test('runWithConcurrency never exceeds concurrency limit of 3', async () => {
  let inFlight = 0;
  let peak = 0;
  const items = [1, 2, 3, 4, 5, 6, 7, 8];

  const results = await runWithConcurrency(items, 3, async (item) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 10));
    inFlight -= 1;
    return item * 2;
  });

  assert.equal(peak, 3);
  assert.deepEqual(results, [2, 4, 6, 8, 10, 12, 14, 16]);
});

test('dedupeRows removes duplicates by chosen key', () => {
  const { rows, removedCount } = dedupeRows(SAMPLE_ROWS, 'title');
  assert.equal(removedCount, 1);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]._id, 'r1');
  assert.equal(rows[1]._id, 'r2');
});

test('filterAndSortRows filters by confidence and sorts numerically', () => {
  const sorted = filterAndSortRows(SAMPLE_ROWS, {
    query: '',
    confidence: 'all',
    sortKey: 'price',
    sortDir: 'asc',
  });
  assert.deepEqual(
    sorted.map((r) => r.values.price),
    [9.5, 19.99, 21]
  );

  const highOnly = filterAndSortRows(SAMPLE_ROWS, {
    query: 'alpha',
    confidence: 'high',
    sortKey: null,
    sortDir: 'asc',
  });
  assert.equal(highOnly.length, 1);
  assert.equal(highOnly[0]._id, 'r1');
});

test('exportToCsv escapes quotes and commas per RFC 4180', () => {
  const csv = exportToCsv(SAMPLE_FIELDS, [SAMPLE_ROWS[0]]);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'title,price,tags,confidence,source_snippet,source_url,notes');
  assert.ok(lines[1].startsWith('"Alpha, ""Special""",19.99,"sci-fi, new",high,'));
});

test('buildCreativeStudioPayload matches required export schema shape', () => {
  const payload = buildCreativeStudioPayload(
    ['https://books.example/1', 'https://books.example/1'],
    SAMPLE_FIELDS,
    [SAMPLE_ROWS[0]],
    '2026-11-18T12:00:00.000Z'
  );
  assert.deepEqual(Object.keys(payload).sort(), ['extracted_at', 'fields', 'rows', 'source_urls']);
  assert.deepEqual(payload.source_urls, ['https://books.example/1']);
  assert.equal(payload.extracted_at, '2026-11-18T12:00:00.000Z');
  assert.equal(payload.rows.length, 1);
  assert.equal(payload.rows[0].title, 'Alpha, "Special"');
});

test('parseEditedCellValue parses typed values cleanly', () => {
  assert.equal(parseEditedCellValue('$42.50', 'number'), 42.5);
  assert.equal(parseEditedCellValue('null', 'string'), null);
  assert.equal(parseEditedCellValue('true', 'boolean'), true);
  assert.deepEqual(parseEditedCellValue('a, b, c', 'list'), ['a', 'b', 'c']);
});
