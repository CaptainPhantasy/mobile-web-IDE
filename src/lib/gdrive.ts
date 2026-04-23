// Google Drive integration using the Google Identity Services (GIS)
// token model and Google Drive REST v3. Works entirely client-side.
//
// Configuration: the user supplies their OAuth2 Client ID via the
// Settings panel. It is persisted via the kv layer. No API key is
// required because public Drive access is not used.

import { kvGet, kvSet, kvDel } from './kv';
import { readBytes, writeBytes, writeText, join, basename } from './fs';

declare global {
  interface Window {
    google?: any;
    gapi?: any;
  }
}

const CLIENT_ID_KEY = 'gdrive.clientId';
const TOKEN_KEY = 'gdrive.token';

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  parents?: string[];
};

export async function setClientId(id: string): Promise<void> {
  await kvSet(CLIENT_ID_KEY, id);
}

export async function getClientId(): Promise<string | undefined> {
  return await kvGet<string>(CLIENT_ID_KEY);
}

export async function cachedToken(): Promise<string | undefined> {
  const t = await kvGet<{ token: string; exp: number }>(TOKEN_KEY);
  if (!t) return undefined;
  if (t.exp < Date.now()) return undefined;
  return t.token;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
}

export async function signIn(scopes = 'https://www.googleapis.com/auth/drive.file'): Promise<string> {
  const clientId = await getClientId();
  if (!clientId) throw new Error('Google Drive Client ID not configured. Open Settings.');
  await loadScript('https://accounts.google.com/gsi/client');
  if (!window.google?.accounts?.oauth2) {
    throw new Error('Google Identity Services failed to load');
  }
  return await new Promise<string>((resolve, reject) => {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: scopes,
      callback: async (resp: any) => {
        if (resp.error) return reject(new Error(resp.error));
        const exp = Date.now() + (resp.expires_in - 60) * 1000;
        await kvSet(TOKEN_KEY, { token: resp.access_token, exp });
        resolve(resp.access_token);
      },
    });
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

export async function signOut(): Promise<void> {
  await kvDel(TOKEN_KEY);
}

async function driveToken(): Promise<string> {
  const t = await cachedToken();
  if (t) return t;
  return await signIn();
}

async function drive<T = unknown>(
  path: string,
  opts: { method?: string; body?: any; query?: Record<string, string> } = {},
): Promise<T> {
  const token = await driveToken();
  const url = new URL('https://www.googleapis.com/drive/v3' + path);
  for (const [k, v] of Object.entries(opts.query || {})) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    method: opts.method || 'GET',
    headers: {
      Authorization: 'Bearer ' + token,
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new Error(`Drive ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

export async function listFiles(
  opts: { q?: string; pageSize?: number } = {},
): Promise<DriveFile[]> {
  const res = await drive<{ files: DriveFile[] }>('/files', {
    query: {
      q: opts.q || "trashed = false",
      pageSize: String(opts.pageSize || 100),
      fields: 'files(id,name,mimeType,modifiedTime,size,parents)',
    },
  });
  return res.files || [];
}

export async function downloadFile(id: string): Promise<Uint8Array> {
  const token = await driveToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${id}?alt=media`,
    { headers: { Authorization: 'Bearer ' + token } },
  );
  if (!res.ok) throw new Error(`Drive download ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function uploadFile(
  name: string,
  bytes: Uint8Array,
  mimeType = 'application/octet-stream',
): Promise<DriveFile> {
  const token = await driveToken();
  const metadata = { name, mimeType };
  const boundary = '-------' + Math.random().toString(16).slice(2);
  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`;
  const enc = new TextEncoder();
  const head = enc.encode(body);
  const tail = enc.encode(`\r\n--${boundary}--`);
  const payload = new Uint8Array(head.length + bytes.length + tail.length);
  payload.set(head, 0);
  payload.set(bytes, head.length);
  payload.set(tail, head.length + bytes.length);
  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,size',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'multipart/related; boundary=' + boundary,
      },
      body: payload,
    },
  );
  if (!res.ok) throw new Error(`Drive upload ${res.status}: ${await res.text()}`);
  return (await res.json()) as DriveFile;
}

export async function importFileToProject(
  file: DriveFile,
  projectDir: string,
): Promise<string> {
  const bytes = await downloadFile(file.id);
  const target = join(projectDir, file.name);
  await writeBytes(target, bytes);
  return target;
}

export async function exportPathToDrive(
  localPath: string,
): Promise<DriveFile> {
  const bytes = await readBytes(localPath);
  return await uploadFile(basename(localPath), bytes, 'text/plain');
}

// Sync an entire project's text files into a Drive folder named after
// the project. Creates the folder if it does not exist.
export async function syncProjectToDrive(
  projectDir: string,
  fileList: string[],
): Promise<{ uploaded: number; folder: string }> {
  const folderName = basename(projectDir);
  const folders = await drive<{ files: DriveFile[] }>('/files', {
    query: {
      q: `mimeType = 'application/vnd.google-apps.folder' and name = '${folderName.replace(
        /'/g,
        "\\'",
      )}' and trashed = false`,
      fields: 'files(id,name)',
    },
  });
  let folderId: string;
  if (folders.files.length > 0) {
    folderId = folders.files[0].id;
  } else {
    const created = await drive<{ id: string }>('/files', {
      method: 'POST',
      body: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
      },
    });
    folderId = created.id;
  }
  let uploaded = 0;
  for (const path of fileList) {
    try {
      const bytes = await readBytes(path);
      const name = basename(path);
      await uploadFile(name, bytes, 'text/plain');
      uploaded++;
    } catch {}
  }
  return { uploaded, folder: folderId };
}

export async function writeTextToFs(path: string, text: string): Promise<void> {
  await writeText(path, text);
}
