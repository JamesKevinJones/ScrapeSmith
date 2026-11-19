import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fieldsToJsonSchema,
  inferFieldType,
  parseFreeTextToFields,
  parseJsonSchemaText,
} from './schemaBuilder';

test('parseFreeTextToFields infers types and deduplicates names', () => {
  const fields = parseFreeTextToFields(
    'product name, price, rating, in_stock, release date, product_url, tags, price'
  );

  assert.equal(fields.length, 7);
  assert.equal(fields.find((f) => f.name === 'product_name')?.type, 'string');
  assert.equal(fields.find((f) => f.name === 'price')?.type, 'number');
  assert.equal(fields.find((f) => f.name === 'rating')?.type, 'number');
  assert.equal(fields.find((f) => f.name === 'in_stock')?.type, 'boolean');
  assert.equal(fields.find((f) => f.name === 'release_date')?.type, 'date');
  assert.equal(fields.find((f) => f.name === 'product_url')?.type, 'url');
  assert.equal(fields.find((f) => f.name === 'tags')?.type, 'list');
  assert.equal(inferFieldType('review_count'), 'number');
});

test('fieldsToJsonSchema and parseJsonSchemaText round-trip single and list modes', () => {
  const fields = parseFreeTextToFields('title, price, available');
  const listSchema = fieldsToJsonSchema(fields, 'list');
  const parsedList = parseJsonSchemaText(JSON.stringify(listSchema, null, 2));

  assert.equal(parsedList.valid, true);
  assert.equal(parsedList.mode, 'list');
  assert.equal(parsedList.fields?.length, 3);
  assert.ok(listSchema.properties.items?.items?.properties?.confidence);
  assert.ok(listSchema.properties.items?.items?.properties?.source_snippet);

  const singleSchema = fieldsToJsonSchema(fields, 'single');
  const parsedSingle = parseJsonSchemaText(JSON.stringify(singleSchema, null, 2));
  assert.equal(parsedSingle.valid, true);
  assert.equal(parsedSingle.mode, 'single');
});

test('parseJsonSchemaText reports syntax and structural errors cleanly', () => {
  const badJson = parseJsonSchemaText('{ invalid json');
  assert.equal(badJson.valid, false);
  assert.ok(badJson.error?.includes('Invalid JSON'));

  const badStruct = parseJsonSchemaText(JSON.stringify({ type: 'array' }));
  assert.equal(badStruct.valid, false);
});
