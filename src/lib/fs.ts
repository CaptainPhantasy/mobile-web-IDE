// Virtual file system layer built on top of @isomorphic-git/lightning-fs
// Provides an async promise-based POSIX-like API used by the IDE for
// storage of projects, editing, git operations and terminal commands.
//
// All data persists in IndexedDB under the "webide-fs" database.

import LightningFS from '@isomorphic-git/lightning-fs';

export type StatLike = {
  type: 'file' | 'dir';
  size: number;
  mtimeMs: number;
  mode: number;
};

const FS_NAME = 'webide-fs';
const fsInstance = new LightningFS(FS_NAME);
export const pfs = fsInstance.promises;
export const rawFs = fsInstance;

export const ROOT = '/projects';

export async function ensureRoot(): Promise<void> {
  try {
    await pfs.mkdir(ROOT);
  } catch (err: any) {
    if (err && err.code !== 'EEXIST') throw err;
  }
}

export function join(...parts: string[]): string {
  const s = parts
    .map((p) => p.replace(/\/+$/g, ''))
    .join('/')
    .replace(/\/+/g, '/');
  return s.startsWith('/') ? s : '/' + s;
}

export function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.substring(0, i);
}

export function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.substring(i + 1);
}

export function extname(p: string): string {
  const base = basename(p);
  const i = base.lastIndexOf('.');
  return i === -1 ? '' : base.substring(i);
}

export async function exists(path: string): Promise<boolean> {
  try {
    await pfs.stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function mkdirp(path: string): Promise<void> {
  const parts = path.split('/').filter(Boolean);
  let cur = '';
  for (const p of parts) {
    cur += '/' + p;
    try {
      await pfs.mkdir(cur);
    } catch (err: any) {
      if (err && err.code !== 'EEXIST') throw err;
    }
  }
}

export async function readText(path: string): Promise<string> {
  const data = (await pfs.readFile(path, 'utf8')) as unknown as string;
  return data;
}

export async function writeText(path: string, data: string): Promise<void> {
  await mkdirp(dirname(path));
  await pfs.writeFile(path, data, 'utf8' as any);
}

export async function writeBytes(path: string, data: Uint8Array): Promise<void> {
  await mkdirp(dirname(path));
  await pfs.writeFile(path, data as any);
}

export async function readBytes(path: string): Promise<Uint8Array> {
  return (await pfs.readFile(path)) as Uint8Array;
}

export async function remove(path: string): Promise<void> {
  const st = await pfs.stat(path);
  if ((st as any).type === 'dir') {
    const entries = await pfs.readdir(path);
    for (const name of entries) {
      await remove(join(path, name));
    }
    await pfs.rmdir(path);
  } else {
    await pfs.unlink(path);
  }
}

export async function rename(from: string, to: string): Promise<void> {
  await mkdirp(dirname(to));
  await pfs.rename(from, to);
}

export async function stat(path: string): Promise<StatLike> {
  const s = (await pfs.stat(path)) as any;
  return {
    type: s.type === 'dir' ? 'dir' : 'file',
    size: s.size || 0,
    mtimeMs: s.mtimeMs || 0,
    mode: s.mode || 0,
  };
}

export async function readdir(path: string): Promise<string[]> {
  return (await pfs.readdir(path)) as unknown as string[];
}

export type FsNode = {
  path: string;
  name: string;
  type: 'file' | 'dir';
  children?: FsNode[];
  size?: number;
  mtimeMs?: number;
};

export async function walk(root: string, maxDepth = 8): Promise<FsNode> {
  const st = await stat(root);
  const node: FsNode = {
    path: root,
    name: basename(root) || '/',
    type: st.type,
    size: st.size,
    mtimeMs: st.mtimeMs,
  };
  if (st.type === 'dir' && maxDepth > 0) {
    const entries = await readdir(root);
    entries.sort();
    node.children = [];
    for (const name of entries) {
      if (name === '.git' && maxDepth < 8) continue; // skip .git subtree visually
      try {
        const child = await walk(join(root, name), maxDepth - 1);
        node.children.push(child);
      } catch {}
    }
    // sort dirs first
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }
  return node;
}

// Recursively copy a directory tree into the virtual FS from plain text files.
export async function seedFromRecord(
  dir: string,
  record: Record<string, string>,
): Promise<void> {
  await mkdirp(dir);
  for (const [rel, data] of Object.entries(record)) {
    const full = join(dir, rel);
    await writeText(full, data);
  }
}

// Grep-style project-wide search with include/exclude globs.
export async function* walkFiles(
  root: string,
  opts: { skip?: string[] } = {},
): AsyncGenerator<string> {
  const skip = new Set(opts.skip || ['.git', 'node_modules', 'dist', 'build']);
  const stack: string[] = [root];
  while (stack.length) {
    const cur = stack.pop()!;
    const st = await stat(cur);
    if (st.type === 'file') {
      yield cur;
      continue;
    }
    const entries = await readdir(cur);
    for (const name of entries) {
      if (skip.has(name)) continue;
      stack.push(join(cur, name));
    }
  }
}
