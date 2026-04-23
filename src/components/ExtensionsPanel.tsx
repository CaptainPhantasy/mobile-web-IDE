// Extensions manager UI. Shows installed extensions, lets the user
// enable/disable/uninstall them, and install a new extension either
// from the built-in gallery or by pasting custom JS source.

import { useEffect, useState } from 'react';
import * as ext from '../lib/extensions';

type Props = {
  onRefreshCommands: () => void;
};

export default function ExtensionsPanel({ onRefreshCommands }: Props) {
  const [items, setItems] = useState<ext.InstalledExtension[]>([]);
  const [name, setName] = useState('');
  const [source, setSource] = useState('');

  async function refresh() {
    setItems(await ext.listInstalled());
  }

  useEffect(() => {
    refresh();
  }, []);

  async function installBuiltin(b: (typeof ext.BUILTIN_EXTENSIONS)[number]) {
    await ext.install(b);
    await ext.setEnabled(b.id, true);
    await refresh();
    onRefreshCommands();
  }

  async function installCustom() {
    if (!name || !source) return;
    const id = 'user.' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    await ext.install({ id, name, version: '1.0.0', source });
    await ext.setEnabled(id, true);
    setName('');
    setSource('');
    await refresh();
    onRefreshCommands();
  }

  async function toggle(id: string, enabled: boolean) {
    await ext.setEnabled(id, enabled);
    await refresh();
    onRefreshCommands();
  }

  async function remove(id: string) {
    if (!confirm('Uninstall ' + id + '?')) return;
    await ext.uninstall(id);
    await refresh();
    onRefreshCommands();
  }

  return (
    <div className="panel ext-panel">
      <div className="panel-header">
        <div className="panel-title">Extensions</div>
      </div>

      <div className="ext-section">
        <div className="ext-subtitle">Built-in gallery</div>
        {ext.BUILTIN_EXTENSIONS.map((b) => {
          const installed = items.find((i) => i.id === b.id);
          return (
            <div key={b.id} className="ext-row">
              <div>
                <div><strong>{b.name}</strong></div>
                <div className="muted small">{b.description}</div>
              </div>
              {installed ? (
                <div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={installed.enabled}
                      onChange={(e) => toggle(b.id, e.target.checked)}
                    />
                    <span>{installed.enabled ? 'Enabled' : 'Disabled'}</span>
                  </label>
                  <button onClick={() => remove(b.id)}>Uninstall</button>
                </div>
              ) : (
                <button onClick={() => installBuiltin(b)}>Install</button>
              )}
            </div>
          );
        })}
      </div>

      <div className="ext-section">
        <div className="ext-subtitle">Installed</div>
        {items.map((i) => (
          <div key={i.id} className="ext-row">
            <div>
              <div><strong>{i.name}</strong> <span className="muted">v{i.version}</span></div>
              <div className="muted small">{i.id}</div>
            </div>
            <div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={i.enabled}
                  onChange={(e) => toggle(i.id, e.target.checked)}
                />
                <span>{i.enabled ? 'Enabled' : 'Disabled'}</span>
              </label>
              <button onClick={() => remove(i.id)}>Uninstall</button>
            </div>
          </div>
        ))}
        {items.length === 0 && <div className="muted">None installed yet.</div>}
      </div>

      <div className="ext-section">
        <div className="ext-subtitle">Install custom extension</div>
        <input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <textarea
          placeholder="exports.activate = (ide) => { ide.registerCommand({...}); };"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          rows={6}
        />
        <button onClick={installCustom} disabled={!name || !source}>
          Install custom
        </button>
      </div>
    </div>
  );
}
