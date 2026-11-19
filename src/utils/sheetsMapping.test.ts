import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExtractedRow, FieldDefinition } from '../types';
import {
  buildSheetValuesMatrix,
  createDefaultSheetMappings,
  extractSpreadsheetId,
  indexToColumnLetter,
} from './sheetsMapping';

test('indexToColumnLetter converts 0-based indices to spreadsheet columns', () => {
  assert.equal(indexToColumnLetter(0), 'A');
  assert.equal(indexToColumnLetter(25), 'Z');
  assert.equal(indexToColumnLetter(26), 'AA');
  assert.equal(indexToColumnLetter(27), 'AB');
});

test('extractSpreadsheetId parses full Google Sheets URLs and raw IDs', () => {
  assert.equal(
    extractSpreadsheetId('https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0'),
    '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'
  );
  assert.equal(extractSpreadsheetId('  rawSheetId_123  '), 'rawSheetId_123');
});

test('buildSheetValuesMatrix maps included JSON fields to custom sheet headers accurately', () => {
  const fields: FieldDefinition[] = [
    { id: '1', name: 'product_name', type: 'string' },
    { id: '2', name: 'price', type: 'number' },
  ];
  const mappings = createDefaultSheetMappings(fields).map((m) =>
    m.sourceKey === 'product_name'
      ? { ...m, sheetHeader: 'Item Title' }
      : m.sourceKey === '__source_snippet'
        ? { ...m, included: false }
        : m
  );

  const rows: ExtractedRow[] = [
    {
      _id: 'r1',
      _sourceUrl: 'https://shop.example/1',
      confidence: 'high',
      source_snippet: 'Widget $29.99',
      notes: 'USD',
      values: { product_name: 'Widget', price: 29.99 },
    },
  ];

  const withHeaders = buildSheetValuesMatrix(mappings, rows, true);
  assert.deepEqual(withHeaders, [
    ['Item Title', 'Price', 'Confidence', 'Source URL'],
    ['Widget', 29.99, 'high', 'https://shop.example/1'],
  ]);

  const withoutHeaders = buildSheetValuesMatrix(mappings, rows, false);
  assert.deepEqual(withoutHeaders, [['Widget', 29.99, 'high', 'https://shop.example/1']]);
});
