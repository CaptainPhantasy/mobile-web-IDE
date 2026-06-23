import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'path';
import { rmSync } from 'fs';
import { readAudit, appendAudit } from './audit-log';
import type { AuditEntry } from './types';

describe('audit-log', () => {
  test('returns empty list when file missing', async () => {
    const missing = resolve(process.cwd(), `no-such-audit-${Date.now()}.log`);
    assert.deepEqual(await readAudit('x', { auditPath: missing }), []);
  });

  test('appends and reads newest-first, filtered by repo', async () => {
    const p = resolve(process.cwd(), `.tmp-audit-${Date.now()}.log`);
    const mk = (repoId: string, actionId: string): AuditEntry => ({
      timestamp: new Date().toISOString(),
      repoId,
      actionId,
      command: 'git',
      args: [],
      cwd: '/x',
      exitCode: 0,
      signal: null,
      durationMs: 1,
      timedOut: false,
    });
    try {
      await appendAudit(mk('r1', 'a1'), { auditPath: p });
      await appendAudit(mk('r2', 'b1'), { auditPath: p });
      await appendAudit(mk('r1', 'a2'), { auditPath: p });
      const r = await readAudit('r1', { auditPath: p });
      assert.equal(r.length, 2);
      assert.equal(r[0].actionId, 'a2');
      assert.equal(r[1].actionId, 'a1');
    } finally {
      rmSync(p, { force: true });
    }
  });
});
