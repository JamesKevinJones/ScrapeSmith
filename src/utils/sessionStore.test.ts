import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSessionHeader,
  clearAllSessions,
  extractOrigin,
  formatRemainingTtl,
  getSessionHeaderForUrl,
  listActiveSessions,
  revokeSession,
  saveTemporarySession,
} from './sessionStore';

test('buildSessionHeader builds Cookie, Bearer, and Basic headers with masked previews', () => {
  const cookie = buildSessionHeader('session_cookie', { cookieOrToken: 'Cookie: sid=1234567890abcdef' });
  assert.equal(cookie?.headerName, 'Cookie');
  assert.equal(cookie?.headerValue, 'sid=1234567890abcdef');
  assert.ok(cookie?.maskedPreview.includes('••••••'));

  const bearer = buildSessionHeader('bearer_token', { cookieOrToken: 'tok_secret_value_9999' });
  assert.equal(bearer?.headerName, 'Authorization');
  assert.equal(bearer?.headerValue, 'Bearer tok_secret_value_9999');

  const basic = buildSessionHeader('basic_credentials', { username: 'alice', password: 'pw!' });
  assert.equal(basic?.headerName, 'Authorization');
  assert.ok(basic?.headerValue.startsWith('Basic '));
  assert.ok(!basic?.maskedPreview.includes('pw!'));
});

test('saveTemporarySession matches origin, auto-expires after TTL, and revokes cleanly', () => {
  clearAllSessions();
  const baseTime = 1_700_000_000_000;

  assert.equal(extractOrigin('https://portal.example.com/app/dashboard?x=1'), 'https://portal.example.com');

  const saved = saveTemporarySession(
    {
      urlOrOrigin: 'https://portal.example.com/dashboard',
      authType: 'session_cookie',
      headerName: 'Cookie',
      headerValue: 'sid=abc123',
      maskedPreview: 'Cookie (sid••••••123)',
      ttlMinutes: 15,
    },
    false,
    baseTime
  );

  assert.ok(saved);
  assert.equal(listActiveSessions(baseTime + 1000).length, 1);

  const matched = getSessionHeaderForUrl('https://portal.example.com/other/page', baseTime + 60_000);
  assert.deepEqual(matched, { headerName: 'Cookie', headerValue: 'sid=abc123' });

  // Different origin does not receive session header
  assert.equal(getSessionHeaderForUrl('https://other.example.com/page', baseTime + 60_000), null);

  // Auto-expires after 15 minutes
  assert.equal(
    getSessionHeaderForUrl('https://portal.example.com/other/page', baseTime + 16 * 60_000),
    null
  );
  assert.equal(formatRemainingTtl(baseTime + 90_000, baseTime), '1m 30s left');

  // Re-save and revoke
  saveTemporarySession(
    {
      urlOrOrigin: 'https://portal.example.com',
      authType: 'bearer_token',
      headerName: 'Authorization',
      headerValue: 'Bearer xyz',
      maskedPreview: 'Bearer ••••••',
      ttlMinutes: 15,
    },
    false,
    baseTime
  );
  revokeSession('https://portal.example.com');
  assert.equal(listActiveSessions(baseTime).length, 0);
});
