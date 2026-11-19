import test from 'node:test';
import assert from 'node:assert/strict';
import type { FieldDefinition } from '../src/types/index.ts';
import {
  expandHtmlTables,
  extractByCssSelectors,
  extractHydrationData,
} from './htmlExtractor.ts';

test('expandHtmlTables flattens colspan and rowspan merged cells into a lossless 2D grid', () => {
  const html = `
    <table>
      <caption>Quarterly Pricing</caption>
      <thead>
        <tr>
          <th rowspan="2">Plan</th>
          <th colspan="2">Pricing</th>
        </tr>
        <tr>
          <th>Monthly</th>
          <th>Annual</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td rowspan="2">Pro</td>
          <td>$29</td>
          <td>$290</td>
        </tr>
        <tr>
          <td>$39 (Team)</td>
          <td>$390 (Team)</td>
        </tr>
      </tbody>
    </table>
  `;

  const tables = expandHtmlTables(html);
  assert.equal(tables.length, 1);
  assert.equal(tables[0].caption, 'Quarterly Pricing');
  assert.equal(tables[0].mergedCellCount, 3);
  assert.deepEqual(tables[0].rows, [
    ['Plan', 'Pricing', 'Pricing'],
    ['Plan', 'Monthly', 'Annual'],
    ['Pro', '$29', '$290'],
    ['Pro', '$39 (Team)', '$390 (Team)'],
  ]);
  assert.ok(tables[0].markdown.includes('| Pro | $39 (Team) | $390 (Team) |'));
});

test('extractByCssSelectors extracts text, numeric values, and href/data-* attributes in list mode', () => {
  const html = `
    <div class="catalog">
      <article class="card">
        <h3 class="title"><a href="/books/alpha">Alpha Guide</a></h3>
        <span class="price" data-raw="19.50">£19.50</span>
      </article>
      <article class="card">
        <h3 class="title"><a href="/books/beta">Beta Manual</a></h3>
        <span class="price" data-raw="42.00">£42.00</span>
      </article>
    </div>
  `;

  const fields: FieldDefinition[] = [
    { id: '1', name: 'title', type: 'string', rules: { cssSelector: 'article.card h3.title a', attribute: 'text' } },
    { id: '2', name: 'price', type: 'number', rules: { cssSelector: 'article.card .price', attribute: 'data-raw' } },
    { id: '3', name: 'product_url', type: 'url', rules: { cssSelector: 'article.card h3.title a', attribute: 'href' } },
  ];

  const result = extractByCssSelectors(html, 'https://shop.example.com/list', fields, 'list');
  assert.equal(result.matchedFields.length, 3);
  assert.equal(result.unmatchedFields.length, 0);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].values.title, 'Alpha Guide');
  assert.equal(result.rows[0].values.price, 19.5);
  assert.equal(result.rows[0].values.product_url, 'https://shop.example.com/books/alpha');
  assert.equal(result.rows[1].values.title, 'Beta Manual');
  assert.equal(result.rows[1].values.price, 42);
  assert.equal(result.rows[0].confidence, 'high');
});

test('extractHydrationData pulls JSON-LD and __NEXT_DATA__ scripts for dynamic pages', () => {
  const html = `
    <html>
      <head>
        <script type="application/ld+json">{"@type":"Product","name":"Widget","price":49}</script>
      </head>
      <body>
        <div id="__next"></div>
        <script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"sku":"W-100"}}}</script>
      </body>
    </html>
  `;

  const payloads = extractHydrationData(html);
  assert.equal(payloads.length, 2);
  assert.ok(payloads[0].includes('"Widget"'));
  assert.ok(payloads[1].includes('"W-100"'));
});
