import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { executeAction, validateActionArgs, clampTimeout, preflight } from './action-runner';
import type { CockpitConfig, ActionConfig } from './types';

const config: CockpitConfig = {
  version: 1,
  auth: { required: false, tokenEnv: 'MWIDE_COCKPIT_TOKEN' },
  workspaceRoots: ['/tmp/test'],
  repos: [
    {
      id: 'r',
      label: 'R',
      path: '/tmp/test/r',
      actions: [
        { id: 'git-status', label: 'Git Status', kind: 'read', command: 'git', args: ['status'], confirm: true },
      ],
    },
  ],
};

describe('clampTimeout', () => {
  test('clamps to max', () => assert.equal(clampTimeout(1_000_000_000), 900_000));
  test('clamps to min', () => assert.equal(clampTimeout(0), 1000));
  test('default when undefined', () => assert.equal(clampTimeout(undefined), 120_000));
  test('passthrough middle values', () => assert.equal(clampTimeout(50_000), 50_000));
});

describe('validateActionArgs', () => {
  test('accepts safe args', () => assert.equal(validateActionArgs('git', ['status']).ok, true));
  test('rejects semicolon', () => {
    const r = validateActionArgs('git', ['status; echo evil']);
    assert.ok(r.ok === false && r.error.includes('shell-control token'));
  });
  test('rejects &&', () => {
    const r = validateActionArgs('git', ['status && echo bad']);
    assert.equal(r.ok, false);
  });
  test('rejects pipe', () => {
    const r = validateActionArgs('git', ['status | grep x']);
    assert.equal(r.ok, false);
  });
});

describe('executeAction guards', () => {
  test('rejects unknown repo with 404', async () => {
    const r = await executeAction(config, 'nope', 'git-status', {});
    assert.ok(r.ok === false && r.status === 404 && r.error.includes('unknown repo'));
  });
  test('rejects unknown action with 404', async () => {
    const r = await executeAction(config, 'r', 'nope', {});
    assert.ok(r.ok === false && r.status === 404 && r.error.includes('unknown action'));
  });
  test('requires confirmation for confirm action', async () => {
    const r = await executeAction(config, 'r', 'git-status', {});
    assert.ok(r.ok === false && r.status === 400 && r.error.includes('Confirmation required'));
  });
});

describe('preflight', () => {
  const repo = config.repos[0]!;

  test('confirm gate returns 400', () => {
    const r = preflight(repo, repo.actions[0]!, config.workspaceRoots, undefined);
    assert.ok(r.ok === false && r.status === 400);
  });

  test('non-allowlisted command returns 400', () => {
    const action: ActionConfig = { id: 'x', label: 'X', kind: 'read', command: 'rmtool', args: [], confirm: false };
    const r = preflight({ ...repo, actions: [action] }, action, config.workspaceRoots, true);
    assert.ok(r.ok === false && r.status === 400 && r.error.includes('command'));
  });

  test('bash without shellScript returns 400', () => {
    const action: ActionConfig = { id: 'b', label: 'B', kind: 'read', command: 'bash', args: ['-c', 'echo hi'], confirm: false };
    const r = preflight({ ...repo, actions: [action] }, action, config.workspaceRoots, true);
    assert.ok(r.ok === false && r.status === 400 && r.error.includes('shellScript'));
  });
});
