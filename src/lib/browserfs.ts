// Browser-native folder access via File System Access API + IndexedDB persistence.
// Fallback imports are handled in App.tsx because they land in the virtual FS.

import { dirname } from './fs';
import { kvDel, kvGet, kvSet } from './kv';

type FsPermissionState = 'granted' | 'denied' | 'prompt';
type FsPermissionDescriptor = { mode?: 'read' | 'readwrite' };

declare global {
  interface FileSystemHandle {
    queryPermission?: (descriptor?: FsPermissionDescriptor) => Promise<FsPermissionState>;
    requestPermission?: (descriptor?: FsPermissionDescriptor) => Promise<FsPermissionState>;
  }

  interface FileSystemDirectoryHandle {
    entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>;
    values?: () => AsyncIterableIterator<FileSystemHandle>;
  }

  interface Window {
    showDirectoryPicker?: (options?: {
      mode?: 'read' | 'readwrite';
      id?: string;
      startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
    }) => Promise<FileSystemDirectoryHandle>;
  }
}

export type BrowserWorkspace = {
  type: 'browser-folder';
  id: string;
  name: string;
  path: string;
  handle: FileSystemDirectoryHandle;
};

type BrowserEntry = {
  name: string;
  kind: FileSystemHandleKind;
  handle: FileSystemHandle;
};

export type BrowserFsNode = {
  name: string;
  path: string;
  type: 'file' | 'dir';
};

export type BrowserFsListResult = {
  path: string;
  items: BrowserFsNode[];
  total: number;
};

const IDB_KEY_PREFIX = 'browserfs:handle:';
export const BROWSER_ROOT_PREFIX = 'browserfs:';

export function isNativeAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export function isWebkitFallback(): boolean {
  return typeof window !== 'undefined' && !isNativeAvailable() && 'webkitdirectory' in HTMLInputElement.prototype;
}

export function browserRootPath(id: string): string {
  return `${BROWSER_ROOT_PREFIX}${id}`;
}

export function browserPath(id: string, rel = ''): string {
  const clean = normalizeRel(rel);
  return clean ? `${browserRootPath(id)}/${clean}` : browserRootPath(id);
}

export function parseBrowserPath(path: string): { id: string; rel: string } | null {
  if (!path.startsWith(BROWSER_ROOT_PREFIX)) return null;
  const rest = path.slice(BROWSER_ROOT_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash === -1) return { id: rest, rel: '' };
  return { id: rest.slice(0, slash), rel: normalizeRel(rest.slice(slash + 1)) };
}

export function isBrowserPath(path: string): boolean {
  return parseBrowserPath(path) !== null;
}

function normalizeRel(rel: string): string {
  return rel
    .replace(/\\/g, '/')
    .replace(/^\/+/g, '')
    .split('/')
    .filter((part) => part && part !== '.')
    .join('/');
}

function relBasename(rel: string): string {
  const clean = normalizeRel(rel);
  const slash = clean.lastIndexOf('/');
  return slash === -1 ? clean : clean.slice(slash + 1);
}

async function persistHandle(id: string, handle: FileSystemDirectoryHandle): Promise<void> {
  await kvSet(IDB_KEY_PREFIX + id, handle);
}

async function retrieveHandle(id: string): Promise<FileSystemDirectoryHandle | null> {
  try {
    const handle = await kvGet<FileSystemDirectoryHandle>(IDB_KEY_PREFIX + id);
    if (!handle) return null;
    const opts: FsPermissionDescriptor = { mode: 'readwrite' };
    const permission = handle.queryPermission ? await handle.queryPermission(opts) : 'granted';
    if (permission === 'granted') return handle;
    const requested = handle.requestPermission ? await handle.requestPermission(opts) : 'denied';
    if (requested === 'granted') return handle;
    await kvDel(IDB_KEY_PREFIX + id);
    return null;
  } catch {
    return null;
  }
}

export async function removeDirectory(id: string): Promise<void> {
  await kvDel(IDB_KEY_PREFIX + id);
}

export async function pickDirectory(): Promise<BrowserWorkspace | null> {
  if (!isNativeAvailable()) return null;
  try {
    const handle = await window.showDirectoryPicker!({ mode: 'readwrite' });
    const id = `browser-folder-${Date.now()}`;
    await persistHandle(id, handle);
    return { type: 'browser-folder', id, name: handle.name, path: browserRootPath(id), handle };
  } catch (err) {
    if ((err as DOMException)?.name === 'AbortError') return null;
    return null;
  }
}

export async function restoreDirectory(id: string): Promise<BrowserWorkspace | null> {
  const handle = await retrieveHandle(id);
  if (!handle) return null;
  return { type: 'browser-folder', id, name: handle.name, path: browserRootPath(id), handle };
}

async function listDir(dir: FileSystemDirectoryHandle): Promise<BrowserEntry[]> {
  const entries: BrowserEntry[] = [];
  if (dir.entries) {
    for await (const [name, handle] of dir.entries()) {
      entries.push({ name, kind: handle.kind, handle });
    }
  } else if (dir.values) {
    for await (const handle of dir.values()) {
      entries.push({ name: handle.name, kind: handle.kind, handle });
    }
  }
  return entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

async function getDirHandle(root: FileSystemDirectoryHandle, rel: string, create = false): Promise<FileSystemDirectoryHandle> {
  const clean = normalizeRel(rel);
  if (!clean) return root;
  let cur = root;
  for (const part of clean.split('/')) {
    cur = await cur.getDirectoryHandle(part, { create });
  }
  return cur;
}

async function getParentDir(root: FileSystemDirectoryHandle, rel: string, create = false): Promise<FileSystemDirectoryHandle> {
  const parent = dirname('/' + normalizeRel(rel)).replace(/^\/+/g, '');
  return getDirHandle(root, parent, create);
}

async function copyFile(src: FileSystemFileHandle, dstDir: FileSystemDirectoryHandle, dstName: string): Promise<void> {
  const file = await src.getFile();
  const dst = await dstDir.getFileHandle(dstName, { create: true });
  const writable = await dst.createWritable();
  await writable.write(new Uint8Array(await file.arrayBuffer()));
  await writable.close();
}

async function copyDir(src: FileSystemDirectoryHandle, dst: FileSystemDirectoryHandle): Promise<void> {
  for (const entry of await listDir(src)) {
    if (entry.kind === 'file') {
      await copyFile(entry.handle as FileSystemFileHandle, dst, entry.name);
    } else {
      const next = await dst.getDirectoryHandle(entry.name, { create: true });
      await copyDir(entry.handle as FileSystemDirectoryHandle, next);
    }
  }
}

function assertBrowserWorkspacePath(ws: BrowserWorkspace, path: string): string {
  const parsed = parseBrowserPath(path);
  if (!parsed || parsed.id !== ws.id) throw new Error('Path is not in the active browser workspace.');
  return parsed.rel;
}

export async function listBrowserDir(ws: BrowserWorkspace, path: string): Promise<BrowserFsListResult> {
  const rel = assertBrowserWorkspacePath(ws, path);
  const dir = await getDirHandle(ws.handle, rel);
  const entries = await listDir(dir);
  return {
    path: browserPath(ws.id, rel),
    total: entries.length,
    items: entries.map((entry) => {
      const childRel = normalizeRel([rel, entry.name].filter(Boolean).join('/'));
      return {
        name: entry.name,
        path: browserPath(ws.id, childRel),
        type: entry.kind === 'directory' ? 'dir' : 'file',
      };
    }),
  };
}

export async function readBrowserFile(ws: BrowserWorkspace, path: string): Promise<string> {
  const rel = assertBrowserWorkspacePath(ws, path);
  const dir = await getParentDir(ws.handle, rel);
  const fileHandle = await dir.getFileHandle(relBasename(rel), { create: false });
  const file = await fileHandle.getFile();
  return file.text();
}

export async function writeBrowserFile(ws: BrowserWorkspace, path: string, content: string): Promise<void> {
  const rel = assertBrowserWorkspacePath(ws, path);
  const dir = await getParentDir(ws.handle, rel, true);
  const fileHandle = await dir.getFileHandle(relBasename(rel), { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

export async function mkdirBrowserDir(ws: BrowserWorkspace, path: string): Promise<void> {
  const rel = assertBrowserWorkspacePath(ws, path);
  await getDirHandle(ws.handle, rel, true);
}

export async function removeBrowserPath(ws: BrowserWorkspace, path: string): Promise<void> {
  const rel = assertBrowserWorkspacePath(ws, path);
  const parent = await getParentDir(ws.handle, rel);
  await parent.removeEntry(relBasename(rel), { recursive: true });
}

export async function renameBrowserPath(ws: BrowserWorkspace, oldPath: string, newPath: string): Promise<void> {
  const oldRel = assertBrowserWorkspacePath(ws, oldPath);
  const newRel = assertBrowserWorkspacePath(ws, newPath);
  const oldParent = await getParentDir(ws.handle, oldRel);
  const newParent = await getParentDir(ws.handle, newRel, true);
  const oldName = relBasename(oldRel);
  const newName = relBasename(newRel);
  const entry = (await listDir(oldParent)).find((item) => item.name === oldName);
  if (!entry) throw new Error('Path not found.');
  if (entry.kind === 'file') {
    await copyFile(entry.handle as FileSystemFileHandle, newParent, newName);
  } else {
    const next = await newParent.getDirectoryHandle(newName, { create: true });
    await copyDir(entry.handle as FileSystemDirectoryHandle, next);
  }
  await oldParent.removeEntry(oldName, { recursive: true });
}
