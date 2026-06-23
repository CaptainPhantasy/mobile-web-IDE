import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { extractToken, checkAuth } from './auth';
import type { AuthConfig } from './types';

const required: AuthConfig = { required: true, tokenEnv: 'MWIDE_COCKPIT_TOKEN' };

describe('checkAuth', () => {
  test('503 when required and env token not configured', () => {
    const r = checkAuth(null, required, {});
    assert.ok(r.ok === false && r.status === 503);
    assert.ok(r.ok === false && r.error.includes('MWIDE_COCKPIT_TOKEN'));
  });

  test('503 even when a token is presented but server has none', () => {
    const r = checkAuth('whatever', required, {});
    assert.ok(r.ok === false && r.status === 503);
  });

  test('accepts valid bearer token', () => {
    const r = checkAuth('valid', required, { MWIDE_COCKPIT_TOKEN: 'valid' });
    assert.equal(r.ok, true);
  });

  test('401 on wrong token', () => {
    const r = checkAuth('wrong', required, { MWIDE_COCKPIT_TOKEN: 'correct' });
    assert.ok(r.ok === false && r.status === 401 && r.error === 'Unauthorized');
  });

  test('401 when no token presented but server configured', () => {
    const r = checkAuth(null, required, { MWIDE_COCKPIT_TOKEN: 'correct' });
    assert.ok(r.ok === false && r.status === 401);
  });

  test('ok when auth not required', () => {
    const r = checkAuth(null, { required: false, tokenEnv: 'MWIDE_COCKPIT_TOKEN' }, {});
    assert.equal(r.ok, true);
  });
});

describe('extractToken', () => {
  test('from Bearer header', () => {
    assert.equal(extractToken({ authorization: 'Bearer token-from-bearer' }), 'token-from-bearer');
  });
  test('from x-mwide-cockpit-token header', () => {
    assert.equal(extractToken({ 'x-mwide-cockpit-token': 'token-from-custom' }), 'token-from-custom');
  });
  test('null when missing', () => {
    assert.equal(extractToken({}), null);
  });
  test('null when malformed bearer', () => {
    assert.equal(extractToken({ authorization: 'Bearer' }), null);
  });
});
