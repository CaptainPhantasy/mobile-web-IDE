import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getRepoStatus, parseGitStatusPorcelain, parseAheadBehind, parseLastCommit } from './git-status';

const execFileAsync = promisify(execFile);

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout;
}

describe('parseGitStatusPorcelain', () => {
  test('clean repo yields empty array', () => {
    assert.deepEqual(parseGitStatusPorcelain(''), []);
  });
  test('parses changed files', () => {
    const r = parseGitStatusPorcelain(' M src/a.ts\n?? b.txt\n');
    assert.equal(r.length, 2);
    assert.deepEqual(r[0], { path: 'src/a.ts', status: 'M' });
    assert.deepEqual(r[1], { path: 'b.txt', status: '??' });
  });
});

describe('parseAheadBehind', () => {
  test('parses behind\\tahead', () => {
    assert.deepEqual(parseAheadBehind('2\t3'), { ahead: 3, behind: 2 });
  });
  test('empty yields zeros', () => {
    assert.deepEqual(parseAheadBehind(''), { ahead: 0, behind: 0 });
  });
});

describe('parseLastCommit', () => {
  test('parses tab-delimited commit', () => {
    const c = parseLastCommit('abc123\tfix: thing\tDoug\t2026-06-22T00:00:00Z');
    assert.equal(c?.sha, 'abc123');
    assert.equal(c?.subject, 'fix: thing');
    assert.equal(c?.author, 'Doug');
    assert.equal(c?.date, '2026-06-22T00:00:00Z');
  });
  test('empty yields null', () => {
    assert.equal(parseLastCommit(''), null);
  });
});

describe('getRepoStatus', () => {
  test('returns defaults for missing path', async () => {
    const missing = path.join(os.tmpdir(), `mwide-missing-${Date.now()}`);
    const status = await getRepoStatus({
      id: 'missing',
      label: 'Missing',
      path: missing,
      actions: [],
    });
    assert.equal(status.exists, false);
    assert.equal(status.branch, null);
    assert.equal(status.clean, true);
    assert.deepEqual(status.changedFiles, []);
    assert.equal(status.lastCommit, null);
  });

  test('reports real branch, commit, and dirty files for a host repo', async (t) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mwide-git-status-'));
    t.after(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    await runGit(dir, ['init', '--initial-branch=main']);
    await runGit(dir, ['config', 'user.name', 'MWIDE Test']);
    await runGit(dir, ['config', 'user.email', 'mwide@example.test']);
    await writeFile(path.join(dir, 'tracked.txt'), 'one\n', 'utf8');
    await runGit(dir, ['add', 'tracked.txt']);
    await runGit(dir, ['commit', '-m', 'feat: seed repo']);

    await writeFile(path.join(dir, 'tracked.txt'), 'one\ntwo\n', 'utf8');
    await writeFile(path.join(dir, 'new.txt'), 'fresh\n', 'utf8');

    const status = await getRepoStatus({
      id: 'fixture',
      label: 'Fixture',
      path: dir,
      actions: [],
    });

    assert.equal(status.exists, true);
    assert.equal(status.branch, 'main');
    assert.equal(status.clean, false);
    assert.equal(status.ahead, 0);
    assert.equal(status.behind, 0);
    assert.deepEqual(
      status.changedFiles.map((file) => [file.path, file.status]).sort(),
      [
        ['new.txt', '??'],
        ['tracked.txt', 'M'],
      ],
    );
    assert.equal(status.lastCommit?.subject, 'feat: seed repo');
    assert.equal(status.lastCommit?.author, 'MWIDE Test');
    assert.match(status.lastCommit?.sha ?? '', /^[0-9a-f]{40}$/);
  });

  test('returns exists=true but branch=null for a non-repo directory', async (t) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mwide-nonrepo-'));
    t.after(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    const status = await getRepoStatus({
      id: 'plain-dir',
      label: 'Plain Dir',
      path: dir,
      actions: [],
    });

    assert.equal(status.exists, true);
    assert.equal(status.branch, null);
    assert.equal(status.clean, true);
    assert.deepEqual(status.changedFiles, []);
    assert.equal(status.lastCommit, null);
  });
});
