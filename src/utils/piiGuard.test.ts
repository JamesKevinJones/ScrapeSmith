import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPiiViolation } from './piiGuard';

test('blocks personal email, phone number, and home address extraction requests', () => {
  const emailCheck = checkPiiViolation('name, personal email, company', []);
  assert.equal(emailCheck.blocked, true);
  assert.ok(emailCheck.matchedTerms.includes('email addresses'));

  const phoneCheck = checkPiiViolation('', [
    { id: '1', name: 'phone_number', type: 'string' },
    { id: '2', name: 'home_address', type: 'string' },
  ]);
  assert.equal(phoneCheck.blocked, true);
  assert.ok(phoneCheck.matchedTerms.includes('phone numbers'));
  assert.ok(phoneCheck.matchedTerms.includes('home or residential addresses'));
});

test('allows public commercial, product, and editorial fields', () => {
  const res = checkPiiViolation(
    'product name, price, rating, review count, release date, support_url, company_website',
    [
      { id: '1', name: 'product_name', type: 'string' },
      { id: '2', name: 'price', type: 'number' },
      { id: '3', name: 'rating', type: 'number' },
      { id: '4', name: 'support_url', type: 'url' },
      { id: '5', name: 'store_location', type: 'string' },
    ]
  );
  assert.equal(res.blocked, false);
  assert.deepEqual(res.matchedTerms, []);
});
