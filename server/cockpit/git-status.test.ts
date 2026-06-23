import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGitStatusPorcelain, parseAheadBehind, parseLastCommit } from './git-status';

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
