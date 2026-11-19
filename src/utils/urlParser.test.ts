import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_URLS, normalizeUrl, parseTargetInput } from './urlParser';

test('normalizeUrl normalizes domains, trims whitespace, strips hash, and rejects private hosts', () => {
  assert.equal(normalizeUrl('  https://example.com/page#section '), 'https://example.com/page');
  assert.equal(normalizeUrl('books.toscrape.com/'), 'https://books.toscrape.com');
  assert.equal(normalizeUrl('http://localhost:3000/test'), null);
  assert.equal(normalizeUrl('http://127.0.0.1/admin'), null);
  assert.equal(normalizeUrl('javascript:alert(1)'), null);
  assert.equal(normalizeUrl('not a url at all'), null);
});

test('parseTargetInput deduplicates URLs, tracks invalid lines, and caps at 10', () => {
  const lines = [
    'https://example.com/1',
    'https://example.com/1#dup',
    'invalid line here',
    ...Array.from({ length: 11 }, (_, i) => `https://example.com/item-${i + 2}`),
  ].join('\n');

  const parsed = parseTargetInput(lines);
  assert.equal(parsed.inputKind, 'urls');
  assert.equal(parsed.validUrls.length, MAX_URLS);
  assert.equal(parsed.duplicateCount, 1);
  assert.equal(parsed.overflowCount, 2);
  assert.deepEqual(parsed.invalidEntries, ['invalid line here']);
});

test('parseTargetInput detects single-line topic search queries', () => {
  const parsed = parseTargetInput('best ergonomic mechanical keyboards 2026');
  assert.equal(parsed.inputKind, 'topic');
  assert.equal(parsed.topicQuery, 'best ergonomic mechanical keyboards 2026');
  assert.equal(parsed.validUrls.length, 0);
});
