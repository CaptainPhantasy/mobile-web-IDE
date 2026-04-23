// Client library for accessing the host machine's real filesystem
// through the server-side /api/fs/* bridge. Used by FileExplorer
// when the user opens a local folder.

export type LocalFsNode = {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  mtimeMs?: number;
};

export type LocalFsListResult = {
  path: string;
  items: LocalFsNode[];
  total?: number;
  truncated?: boolean;
};

/** Quick-pick destinations for the drive picker. Paths that don't exist
 *  are filtered out by the caller. */
export const QUICK_LOCATIONS: Array<{ label: string; path: string }> = [
  { label: 'Home',       path: '~' },
  { label: 'Volumes',    path: '/Volumes' },
  { label: 'SanDisk1Tb', path: '/Volumes/SanDisk1Tb' },
  { label: 'Storage',    path: '/Volumes/Storage' },
  { label: 'Documents',  path: '~/Documents' },
  { label: 'Desktop',    path: '~/Desktop' },
  { label: 'Downloads',  path: '~/Downloads' },
];

/** Extract a readable error message from an API failure. */
function formatErr(text: string): string {
  // Express default error page is HTML; pull the <pre> message out.
  const m = text.match(/Error:\s*([^<\n]+)/);
  return m ? m[1].trim() : text.slice(0, 200);
}

export async function localList(dirPath: string): Promise<LocalFsListResult> {
  const r = await fetch(`/api/fs/list?path=${encodeURIComponent(dirPath)}`);
  if (!r.ok) {
    const t = await r.text();
    throw new Error(formatErr(t));
  }
  return r.json();
}

export async function localRead(filePath: string): Promise<string> {
  const r = await fetch(`/api/fs/read?path=${encodeURIComponent(filePath)}`);
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Read failed: ${t}`);
  }
  const data = await r.json();
  return data.content;
}

export async function localWrite(filePath: string, content: string): Promise<void> {
  const r = await fetch('/api/fs/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath, content }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Write failed: ${t}`);
  }
}

export async function localMkdir(dirPath: string): Promise<void> {
  const r = await fetch('/api/fs/mkdir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: dirPath }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Mkdir failed: ${t}`);
  }
}

export async function localRename(from: string, to: string): Promise<void> {
  const r = await fetch('/api/fs/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Rename failed: ${t}`);
  }
}

export async function localRemove(filePath: string): Promise<void> {
  const r = await fetch(`/api/fs/remove?path=${encodeURIComponent(filePath)}`, {
    method: 'DELETE',
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Remove failed: ${t}`);
  }
}

export async function localStat(filePath: string): Promise<{
  type: 'file' | 'dir';
  size: number;
  mtimeMs: number;
}> {
  const r = await fetch(`/api/fs/stat?path=${encodeURIComponent(filePath)}`);
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Stat failed: ${t}`);
  }
  return r.json();
}
