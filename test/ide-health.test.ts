import assert from 'node:assert/strict';
import test from 'node:test';
import { ideHealthPayload, ideSurfaceIdentity } from '../src/lib/ide-health.ts';

test('IDE identity has the exact admitted provenance shape', () => {
  assert.deepEqual(ideSurfaceIdentity(
    { FLOYD_SURFACE_COMMIT: 'abc123' },
    '/runtime/ide-copy',
  ), {
    surface_id: 'ide',
    source_root: '/runtime/ide-copy',
    source_commit: 'abc123',
  });
});

test('IDE identity defaults an absent runtime commit to unverified', () => {
  assert.deepEqual(ideSurfaceIdentity({}, '/runtime/ide-copy'), {
    surface_id: 'ide',
    source_root: '/runtime/ide-copy',
    source_commit: 'unverified',
  });
});

test('IDE health preserves existing fields and merges runtime identity', () => {
  assert.deepEqual(ideHealthPayload(
    new Date('2026-07-14T12:34:56.000Z'),
    { FLOYD_SURFACE_COMMIT: 'def456' },
    '/runtime/ide-copy',
  ), {
    status: 'ok',
    service: 'mobile-web-ide',
    time: '2026-07-14T12:34:56.000Z',
    identity: {
      surface_id: 'ide',
      source_root: '/runtime/ide-copy',
      source_commit: 'def456',
    },
  });
});
