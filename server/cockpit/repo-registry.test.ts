import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  validateConfig,
  loadConfig,
  getRepo,
  getAction,
  resolveRepoPath,
  toSummary,
  toDetail,
} from './repo-registry';
import type { CockpitConfig, RepoConfig } from './types';

const examplePath = resolve(process.cwd(), 'mwide.repos.example.json');
const exampleRaw: unknown = JSON.parse(readFileSync(examplePath, 'utf-8'));

function exampleConfig(): CockpitConfig {
  const { config } = validateConfig(exampleRaw);
  assert.ok(config, 'example config should validate');
  return config;
}

describe('validateConfig', () => {
  test('accepts valid example config', () => {
    const result = validateConfig(exampleRaw);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
    assert.ok(result.config);
    assert.equal(result.config?.version, 1);
    assert.equal(result.config?.repos.length, 2);
  });

  test('rejects repo outside workspaceRoots', () => {
    const result = validateConfig({
      version: 1,
      auth: { required: true, tokenEnv: 'MWIDE_COCKPIT_TOKEN' },
      workspaceRoots: ['/path/to/root'],
      repos: [{ id: 'outside', label: 'Outside', path: '/some/other/path', actions: [] }],
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('outside workspaceRoots')));
  });

  test('rejects duplicate repo ids', () => {
    const result = validateConfig({
      version: 1,
      auth: { required: true, tokenEnv: 'MWIDE_COCKPIT_TOKEN' },
      workspaceRoots: ['/root'],
      repos: [
        { id: 'dup', label: 'A', path: '/root/a', actions: [] },
        { id: 'dup', label: 'B', path: '/root/b', actions: [] },
      ],
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('duplicate repo ids')));
  });

  test('rejects duplicate action ids', () => {
    const result = validateConfig({
      version: 1,
      auth: { required: true, tokenEnv: 'MWIDE_COCKPIT_TOKEN' },
      workspaceRoots: ['/root'],
      repos: [
        {
          id: 'r',
          label: 'R',
          path: '/root/r',
          actions: [
            { id: 'a', label: 'A', kind: 'read', command: 'git', args: ['status'], confirm: false },
            { id: 'a', label: 'B', kind: 'read', command: 'git', args: ['status'], confirm: false },
          ],
        },
      ],
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('duplicate action ids')));
  });

  test('rejects unsafe command args', () => {
    const result = validateConfig({
      version: 1,
      auth: { required: true, tokenEnv: 'MWIDE_COCKPIT_TOKEN' },
      workspaceRoots: ['/root'],
      repos: [
        {
          id: 'r',
          label: 'R',
          path: '/root/r',
          actions: [
            { id: 'a', label: 'A', kind: 'read', command: 'git', args: ['status; echo evil'], confirm: false },
          ],
        },
      ],
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('shell-control token')));
  });

  test('rejects destructive action without confirm:true', () => {
    const result = validateConfig({
      version: 1,
      auth: { required: true, tokenEnv: 'MWIDE_COCKPIT_TOKEN' },
      workspaceRoots: ['/root'],
      repos: [
        {
          id: 'r',
          label: 'R',
          path: '/root/r',
          actions: [
            { id: 'rm', label: 'Dangerous', kind: 'destructive', command: 'git', args: ['clean'], confirm: false },
          ],
        },
      ],
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('confirm') && e.includes('destructive')));
  });
});

describe('registry helpers', () => {
  test('loadConfig reads a custom path', () => {
    const result = loadConfig({ configPath: examplePath });
    assert.ok(result.config);
    assert.equal(result.configPath, examplePath);
    assert.equal(result.present, true);
  });

  test('loadConfig reports missing file', () => {
    const result = loadConfig({ configPath: resolve(process.cwd(), 'does-not-exist.json') });
    assert.equal(result.present, false);
    assert.equal(result.config, null);
  });

  test('getRepo and getAction', () => {
    const config = exampleConfig();
    const repo = getRepo(config, 'mobile-web-ide');
    assert.ok(repo);
    assert.equal(repo?.label, 'Mobile Web IDE');
    assert.equal(getRepo(config, 'nope'), null);
    assert.equal(getAction(repo!, 'git-status')?.label, 'Git Status');
    assert.equal(getAction(repo!, 'nope'), null);
  });

  test('resolveRepoPath inside vs outside', () => {
    const config = exampleConfig();
    const inside = resolveRepoPath(getRepo(config, 'mobile-web-ide')!, config.workspaceRoots);
    assert.equal(inside.ok, true);
    const outside: RepoConfig = { id: 'x', label: 'X', path: '/outside/path', actions: [] };
    const res = resolveRepoPath(outside, config.workspaceRoots);
    assert.ok(res.ok === false && res.error.includes('outside workspaceRoots'));
  });

  test('toSummary and toDetail', () => {
    const config = exampleConfig();
    const repo = getRepo(config, 'mobile-web-ide')!;
    assert.equal(toSummary(repo).actionCount, 4);
    const detail = toDetail(repo);
    assert.equal(detail.actions.length, 4);
    assert.equal(detail.actions[0].id, 'git-status');
  });
});
