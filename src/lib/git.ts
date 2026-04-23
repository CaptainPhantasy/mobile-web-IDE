// Full Git integration layer using isomorphic-git.
// Supports clone, init, add, commit, push, pull, fetch, checkout,
// branch, log, status, diff, stash-like workflows and remote management.
//
// Works entirely in the browser; uses /api/git-proxy on the backing
// server as a CORS proxy so that any HTTPS git remote (GitHub, GitLab,
// self-hosted) can be spoken to from within the IDE.

import http from 'isomorphic-git/http/web';
import * as git from 'isomorphic-git';
import { rawFs } from './fs';

export type GitAuthor = {
  name: string;
  email: string;
};

export type GitAuth = {
  username?: string;
  password?: string; // personal access token
};

const PROXY = '/api/git-proxy';

export type CloneOpts = {
  dir: string;
  url: string;
  ref?: string;
  singleBranch?: boolean;
  depth?: number;
  auth?: GitAuth;
  onProgress?: (phase: string, loaded?: number, total?: number) => void;
};

export async function clone(opts: CloneOpts): Promise<void> {
  await git.clone({
    fs: rawFs,
    http,
    dir: opts.dir,
    url: opts.url,
    ref: opts.ref,
    singleBranch: opts.singleBranch ?? true,
    depth: opts.depth ?? 50,
    corsProxy: PROXY,
    onAuth: () => opts.auth || {},
    onProgress: (e) => opts.onProgress?.(e.phase, e.loaded, e.total),
  });
}

export async function init(dir: string, defaultBranch = 'main'): Promise<void> {
  await git.init({ fs: rawFs, dir, defaultBranch });
}

export async function add(dir: string, filepath: string | string[]): Promise<void> {
  const paths = Array.isArray(filepath) ? filepath : [filepath];
  for (const p of paths) {
    await git.add({ fs: rawFs, dir, filepath: p });
  }
}

export async function addAll(dir: string): Promise<void> {
  await git.add({ fs: rawFs, dir, filepath: '.' });
}

export async function remove(dir: string, filepath: string): Promise<void> {
  await git.remove({ fs: rawFs, dir, filepath });
}

export async function commit(
  dir: string,
  message: string,
  author: GitAuthor,
): Promise<string> {
  return await git.commit({
    fs: rawFs,
    dir,
    message,
    author: { name: author.name, email: author.email, timestamp: Math.floor(Date.now() / 1000) },
  });
}

export async function push(
  dir: string,
  opts: {
    remote?: string;
    ref?: string;
    auth?: GitAuth;
    force?: boolean;
    onProgress?: (phase: string) => void;
  } = {},
): Promise<git.PushResult> {
  return await git.push({
    fs: rawFs,
    http,
    dir,
    remote: opts.remote || 'origin',
    ref: opts.ref,
    force: opts.force,
    corsProxy: PROXY,
    onAuth: () => opts.auth || {},
    onProgress: (e) => opts.onProgress?.(e.phase),
  });
}

export async function pull(
  dir: string,
  opts: { ref?: string; auth?: GitAuth; author: GitAuthor } & {},
): Promise<void> {
  await git.pull({
    fs: rawFs,
    http,
    dir,
    ref: opts.ref,
    corsProxy: PROXY,
    author: { name: opts.author.name, email: opts.author.email },
    onAuth: () => opts.auth || {},
    singleBranch: true,
  });
}

export async function fetch(
  dir: string,
  opts: { ref?: string; remote?: string; auth?: GitAuth } = {},
): Promise<void> {
  await git.fetch({
    fs: rawFs,
    http,
    dir,
    ref: opts.ref,
    remote: opts.remote || 'origin',
    corsProxy: PROXY,
    onAuth: () => opts.auth || {},
  });
}

export async function status(
  dir: string,
  filepath?: string,
): Promise<string | Array<[string, number, number, number]>> {
  if (filepath) return await git.status({ fs: rawFs, dir, filepath });
  return await git.statusMatrix({ fs: rawFs, dir });
}

export type StatusEntry = {
  path: string;
  head: number;
  workdir: number;
  stage: number;
  label: 'unmodified' | 'modified' | 'new' | 'deleted' | 'staged' | 'unstaged';
};

export async function statusList(dir: string): Promise<StatusEntry[]> {
  const matrix = (await git.statusMatrix({ fs: rawFs, dir })) as Array<
    [string, number, number, number]
  >;
  return matrix
    .map(([path, head, workdir, stage]) => {
      let label: StatusEntry['label'] = 'unmodified';
      if (head === 0 && workdir === 2) label = 'new';
      else if (head === 1 && workdir === 0) label = 'deleted';
      else if (head === 1 && workdir === 2) label = 'modified';
      else if (workdir !== stage) label = 'unstaged';
      else if (head !== stage) label = 'staged';
      return { path, head, workdir, stage, label };
    })
    .filter((e) => e.label !== 'unmodified');
}

export async function log(
  dir: string,
  opts: { depth?: number; ref?: string } = {},
): Promise<git.ReadCommitResult[]> {
  try {
    return await git.log({
      fs: rawFs,
      dir,
      depth: opts.depth ?? 50,
      ref: opts.ref,
    });
  } catch {
    return [];
  }
}

export async function currentBranch(dir: string): Promise<string | undefined> {
  const b = await git.currentBranch({ fs: rawFs, dir, fullname: false });
  return b || undefined;
}

export async function listBranches(dir: string): Promise<string[]> {
  return await git.listBranches({ fs: rawFs, dir });
}

export async function listRemoteBranches(dir: string): Promise<string[]> {
  return await git.listBranches({ fs: rawFs, dir, remote: 'origin' });
}

export async function createBranch(
  dir: string,
  name: string,
  checkoutAfter = true,
): Promise<void> {
  await git.branch({ fs: rawFs, dir, ref: name });
  if (checkoutAfter) {
    await git.checkout({ fs: rawFs, dir, ref: name });
  }
}

export async function deleteBranch(dir: string, name: string): Promise<void> {
  await git.deleteBranch({ fs: rawFs, dir, ref: name });
}

export async function checkout(dir: string, ref: string): Promise<void> {
  await git.checkout({ fs: rawFs, dir, ref });
}

export async function merge(
  dir: string,
  ours: string,
  theirs: string,
  author: GitAuthor,
): Promise<git.MergeResult> {
  return await git.merge({
    fs: rawFs,
    dir,
    ours,
    theirs,
    author: { name: author.name, email: author.email },
  });
}

export async function listRemotes(
  dir: string,
): Promise<Array<{ remote: string; url: string }>> {
  return await git.listRemotes({ fs: rawFs, dir });
}

export async function addRemote(
  dir: string,
  remote: string,
  url: string,
): Promise<void> {
  await git.addRemote({ fs: rawFs, dir, remote, url, force: true });
}

export async function deleteRemote(dir: string, remote: string): Promise<void> {
  await git.deleteRemote({ fs: rawFs, dir, remote });
}

export async function setConfig(
  dir: string,
  path: string,
  value: string,
): Promise<void> {
  await git.setConfig({ fs: rawFs, dir, path, value });
}

export async function getConfig(
  dir: string,
  path: string,
): Promise<string | undefined> {
  return (await git.getConfig({ fs: rawFs, dir, path })) || undefined;
}

// Compute a basic line-level diff between the working copy and HEAD
// for a single file. Pure JS, no external dependency.
export type DiffLine = { kind: ' ' | '+' | '-'; text: string };

export async function diffFile(
  dir: string,
  filepath: string,
): Promise<DiffLine[]> {
  let head = '';
  try {
    const commitOid = await git.resolveRef({ fs: rawFs, dir, ref: 'HEAD' });
    const { blob } = await git.readBlob({
      fs: rawFs,
      dir,
      oid: commitOid,
      filepath,
    });
    head = new TextDecoder().decode(blob);
  } catch {
    head = '';
  }
  let workdir = '';
  try {
    workdir = (await rawFs.promises.readFile(
      (dir + '/' + filepath).replace(/\/+/g, '/'),
      'utf8',
    )) as unknown as string;
  } catch {
    workdir = '';
  }
  return simpleDiff(head, workdir);
}

function simpleDiff(a: string, b: string): DiffLine[] {
  const al = a.split('\n');
  const bl = b.split('\n');
  const n = al.length;
  const m = bl.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (al[i] === bl[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (al[i] === bl[j]) {
      out.push({ kind: ' ', text: al[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: '-', text: al[i] });
      i++;
    } else {
      out.push({ kind: '+', text: bl[j] });
      j++;
    }
  }
  while (i < n) out.push({ kind: '-', text: al[i++] });
  while (j < m) out.push({ kind: '+', text: bl[j++] });
  return out;
}

// Shortcut for staging every working-tree change so that a commit
// mirrors what the user sees in the status list.
export async function stageAll(dir: string): Promise<void> {
  const matrix = await git.statusMatrix({ fs: rawFs, dir });
  for (const [filepath, , worktree] of matrix) {
    if (worktree === 0) {
      await git.remove({ fs: rawFs, dir, filepath });
    } else {
      await git.add({ fs: rawFs, dir, filepath });
    }
  }
}
