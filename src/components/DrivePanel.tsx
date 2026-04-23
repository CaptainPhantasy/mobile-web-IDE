// Google Drive panel: sign in/out, browse Drive files, import into the
// current project, push files/folders up to Drive, and sync the whole
// project to a Drive folder.

import { useEffect, useState } from 'react';
import * as gd from '../lib/gdrive';

type Props = {
  projectDir: string;
  activePath?: string;
  onRefresh: () => void;
};

export default function DrivePanel({ projectDir, activePath, onRefresh }: Props) {
  const [clientId, setClientId] = useState('');
  const [currentId, setCurrentId] = useState('');
  const [files, setFiles] = useState<gd.DriveFile[]>([]);
  const [msg, setMsg] = useState('');
  const [signed, setSigned] = useState(false);

  useEffect(() => {
    gd.getClientId().then((id) => {
      if (id) setCurrentId(id);
    });
    gd.cachedToken().then((t) => setSigned(!!t));
  }, []);

  async function saveClientId() {
    await gd.setClientId(clientId);
    setCurrentId(clientId);
    setClientId('');
    setMsg('Saved client ID.');
  }

  async function signIn() {
    try {
      await gd.signIn();
      setSigned(true);
      setMsg('Signed in.');
    } catch (e: any) {
      setMsg('Sign-in failed: ' + e.message);
    }
  }

  async function signOut() {
    await gd.signOut();
    setSigned(false);
    setMsg('Signed out.');
  }

  async function list() {
    try {
      const f = await gd.listFiles({ pageSize: 200 });
      setFiles(f);
    } catch (e: any) {
      setMsg('List failed: ' + e.message);
    }
  }

  async function importFile(f: gd.DriveFile) {
    try {
      await gd.importFileToProject(f, projectDir);
      setMsg('Imported ' + f.name);
      onRefresh();
    } catch (e: any) {
      setMsg('Import failed: ' + e.message);
    }
  }

  async function exportActive() {
    if (!activePath) return;
    try {
      const res = await gd.exportPathToDrive(activePath);
      setMsg('Uploaded ' + res.name + ' (' + res.id + ')');
    } catch (e: any) {
      setMsg('Upload failed: ' + e.message);
    }
  }

  return (
    <div className="panel drive-panel">
      <div className="panel-header">
        <div className="panel-title">Google Drive</div>
      </div>

      <div className="drive-section">
        <div className="muted small">OAuth Client ID</div>
        {currentId ? (
          <div className="muted small">{currentId}</div>
        ) : (
          <div className="muted small">Not configured.</div>
        )}
        <div className="row">
          <input
            placeholder="1234-abc.apps.googleusercontent.com"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          />
          <button onClick={saveClientId} disabled={!clientId}>Save</button>
        </div>
      </div>

      <div className="drive-section">
        <div className="row">
          {signed ? (
            <button onClick={signOut}>Sign out</button>
          ) : (
            <button onClick={signIn} disabled={!currentId}>Sign in</button>
          )}
          <button onClick={list} disabled={!signed}>Refresh list</button>
          <button onClick={exportActive} disabled={!signed || !activePath}>
            Upload active file
          </button>
        </div>
      </div>

      <div className="drive-section">
        <div className="drive-subtitle">Drive files</div>
        <div className="drive-list">
          {files.map((f) => (
            <div key={f.id} className="drive-row">
              <span>{f.name}</span>
              <span className="muted small">{f.mimeType}</span>
              <button onClick={() => importFile(f)}>Import</button>
            </div>
          ))}
          {files.length === 0 && <div className="muted">No files loaded.</div>}
        </div>
      </div>

      {msg && <div className="panel-status">{msg}</div>}
    </div>
  );
}
