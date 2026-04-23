// Extensions API.
//
// Extensions are plain JavaScript modules that call into the
// `WebIDE` global (registered on window) to contribute to the IDE:
//   - register new commands (shown in the command palette)
//   - add status-bar items
//   - register themes
//   - hook editor / file events
//
// Extensions are stored as text blobs in IndexedDB. On "enable" the
// source is evaluated inside a Function constructor with a reference
// to the host API. No iframe sandbox here (extensions are trusted by
// the user installing them, same model as VS Code / any desktop IDE).

import { kvGet, kvSet } from './kv';
import { BUILTIN_THEMES, Theme } from './themes';

export type IdeCommand = {
  id: string;
  title: string;
  category?: string;
  run: () => void | Promise<void>;
};

export type StatusItem = { id: string; text: string; tooltip?: string };

export type IdeEvent =
  | 'fileOpened'
  | 'fileSaved'
  | 'projectOpened'
  | 'commit'
  | 'run';

export type IdeHost = {
  version: string;
  registerCommand(cmd: IdeCommand): void;
  unregisterCommand(id: string): void;
  listCommands(): IdeCommand[];
  registerStatusItem(item: StatusItem): void;
  registerTheme(theme: Theme): void;
  listThemes(): Theme[];
  on(event: IdeEvent, cb: (payload: unknown) => void): () => void;
  emit(event: IdeEvent, payload: unknown): void;
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  notify(msg: string): void;
};

const commands = new Map<string, IdeCommand>();
const statusItems = new Map<string, StatusItem>();
const themes: Theme[] = [...BUILTIN_THEMES];
const listeners = new Map<IdeEvent, Set<(p: unknown) => void>>();
let notifier: (msg: string) => void = (m) => console.log('[ide]', m);

export function setNotifier(fn: (msg: string) => void): void {
  notifier = fn;
}

export const host: IdeHost = {
  version: '1.0.0',
  registerCommand(cmd) {
    commands.set(cmd.id, cmd);
  },
  unregisterCommand(id) {
    commands.delete(id);
  },
  listCommands() {
    return Array.from(commands.values());
  },
  registerStatusItem(item) {
    statusItems.set(item.id, item);
  },
  registerTheme(theme) {
    if (!themes.find((t) => t.id === theme.id)) themes.push(theme);
  },
  listThemes() {
    return themes;
  },
  on(event, cb) {
    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    set.add(cb);
    return () => set!.delete(cb);
  },
  emit(event, payload) {
    listeners.get(event)?.forEach((cb) => cb(payload));
  },
  readFile: async () => {
    throw new Error('Not wired');
  },
  writeFile: async () => {
    throw new Error('Not wired');
  },
  notify(msg) {
    notifier(msg);
  },
};

export function wireIO(io: {
  readFile(p: string): Promise<string>;
  writeFile(p: string, d: string): Promise<void>;
}): void {
  host.readFile = io.readFile;
  host.writeFile = io.writeFile;
}

export type InstalledExtension = {
  id: string;
  name: string;
  description?: string;
  version: string;
  source: string;
  enabled: boolean;
};

const KEY = 'ext.installed';

export async function listInstalled(): Promise<InstalledExtension[]> {
  return (await kvGet<InstalledExtension[]>(KEY)) || [];
}

export async function install(ext: Omit<InstalledExtension, 'enabled'>): Promise<void> {
  const cur = await listInstalled();
  const idx = cur.findIndex((e) => e.id === ext.id);
  if (idx >= 0) cur[idx] = { ...cur[idx], ...ext };
  else cur.push({ ...ext, enabled: false });
  await kvSet(KEY, cur);
}

export async function setEnabled(id: string, enabled: boolean): Promise<void> {
  const cur = await listInstalled();
  const idx = cur.findIndex((e) => e.id === id);
  if (idx < 0) return;
  cur[idx].enabled = enabled;
  await kvSet(KEY, cur);
  if (enabled) {
    try {
      activate(cur[idx]);
    } catch (err) {
      notifier('Extension "' + id + '" failed: ' + (err as Error).message);
    }
  }
}

export async function uninstall(id: string): Promise<void> {
  const cur = (await listInstalled()).filter((e) => e.id !== id);
  await kvSet(KEY, cur);
  // unregister all commands contributed under the extension namespace
  for (const cmd of Array.from(commands.values())) {
    if (cmd.id.startsWith(id + '.')) commands.delete(cmd.id);
  }
}

function activate(ext: InstalledExtension): void {
  const fn = new Function('ide', 'exports', ext.source);
  const exports: { activate?: (host: IdeHost) => void } = {};
  fn(host, exports);
  if (typeof exports.activate === 'function') exports.activate(host);
}

export async function activateEnabled(): Promise<void> {
  const cur = await listInstalled();
  for (const ext of cur) {
    if (ext.enabled) {
      try {
        activate(ext);
      } catch (err) {
        notifier(`Extension "${ext.id}" failed: ` + (err as Error).message);
      }
    }
  }
}

// Ship a couple of useful built-in extensions users can enable out of
// the box to verify the extensions API works end-to-end.
export const BUILTIN_EXTENSIONS: Omit<InstalledExtension, 'enabled'>[] = [
  {
    id: 'webide.wordcount',
    name: 'Word Count',
    description: 'Adds a "Word count" command that reports stats for the active file.',
    version: '1.0.0',
    source: `exports.activate = (ide) => {
  ide.registerCommand({
    id: 'webide.wordcount.run',
    title: 'Word Count: Active File',
    category: 'Extensions',
    run: async () => {
      const path = window.__WEBIDE_ACTIVE_PATH;
      if (!path) return ide.notify('No active file');
      const text = await ide.readFile(path);
      const lines = text.split('\\n').length;
      const words = text.split(/\\s+/).filter(Boolean).length;
      const chars = text.length;
      ide.notify('Words: ' + words + ', lines: ' + lines + ', chars: ' + chars);
    },
  });
};`,
  },
  {
    id: 'webide.solarized-light',
    name: 'Solarized Light Theme',
    description: 'Registers a Solarized Light theme.',
    version: '1.0.0',
    source: `exports.activate = (ide) => {
  ide.registerTheme({
    id: 'solarized-light',
    label: 'Solarized Light',
    isDark: false,
    colors: {
      '--bg': '#fdf6e3',
      '--bg-2': '#eee8d5',
      '--bg-3': '#e4decb',
      '--fg': '#073642',
      '--fg-2': '#586e75',
      '--accent': '#268bd2',
      '--border': '#93a1a1',
      '--danger': '#dc322f',
      '--ok': '#859900',
    },
    editor: [],
  });
  ide.notify('Solarized Light theme registered.');
};`,
  },
];
