// Local git status service. Pure parsers are unit-tested; getRepoStatus shells out.
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { RepoConfig, RepoStatus, BranchInfo } from './types';

const pExecFile = promisify(execFile);

export function parseGitStatusPorcelain(out: string): Array<{ path: string; status: string }> {
  return out
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => ({ path: line.slice(3), status: line.slice(0, 2).trim() }));
}

export function parseAheadBehind(out: string): { ahead: number; behind: number } {
  // `git rev-list --left-right --count @{upstream}...HEAD` -> "<behind>\t<ahead>"
  const parts = out.trim().split(/\s+/);
  const behind = Number.parseInt(parts[0] ?? '0', 10);
  const ahead = Number.parseInt(parts[1] ?? '0', 10);
  return {
    ahead: Number.isFinite(ahead) ? ahead : 0,
    behind: Number.isFinite(behind) ? behind : 0,
  };
}

export function parseLastCommit(
  line: string,
): { sha: string; subject: string; author: string; date: string } | null {
  const t = line.trim();
  if (!t) return null;
  const [sha, subject, author, date] = t.split('\t');
  if (!sha) return null;
  return { sha, subject: subject ?? '', author: author ?? '', date: date ?? '' };
}

export async function getRepoStatus(repo: RepoConfig): Promise<RepoStatus> {
  const status: RepoStatus = {
    repoId: repo.id,
    path: repo.path,
    exists: false,
    branch: null,
    clean: true,
    ahead: 0,
    behind: 0,
    changedFiles: [],
    lastCommit: null,
  };
  if (!fs.existsSync(repo.path)) return status;
  status.exists = true;

  const run = async (args: string[]): Promise<string> => {
    const { stdout } = await pExecFile('git', args, { cwd: repo.path, maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  };

  try {
    status.branch = (await run(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  } catch {
    return status; // not a git repo
  }
  try {
    status.changedFiles = parseGitStatusPorcelain(await run(['status', '--porcelain=v1']));
    status.clean = status.changedFiles.length === 0;
  } catch {
    /* leave defaults */
  }
  try {
    const ab = parseAheadBehind(await run(['rev-list', '--left-right', '--count', '@{upstream}...HEAD']));
    status.ahead = ab.ahead;
    status.behind = ab.behind;
  } catch {
    status.ahead = 0;
    status.behind = 0; // no upstream configured
  }
  try {
    status.lastCommit = parseLastCommit(await run(['log', '-1', '--pretty=format:%H%x09%s%x09%an%x09%cI']));
  } catch {
    /* no commits */
  }
  return status;
}

export async function getBranches(repo: RepoConfig): Promise<BranchInfo[]> {
  if (!fs.existsSync(repo.path)) return [];
  try {
    const { stdout } = await pExecFile('git', ['branch', '--format=%(refname:short)'], {
      cwd: repo.path,
      maxBuffer: 10 * 1024 * 1024,
    });
    let current = '';
    try {
      const r = await pExecFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo.path });
      current = r.stdout.trim();
    } catch {
      /* ignore */
    }
    return stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((name) => ({ name, current: name === current }));
  } catch {
    return [];
  }
}
