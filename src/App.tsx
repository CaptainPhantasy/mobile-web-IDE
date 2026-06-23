// Mobile Web IDE — main shell.
//
// Layout (responsive):
//   - Top bar: menu, project name, branch, theme picker, collab status,
//     run button, command palette trigger.
//   - Activity bar (left on tablet/desktop, bottom on mobile): files,
//     search, git, debug, drive, extensions, projects, collab.
//   - Side panel: contents of the selected activity.
//   - Editor area: tabs + CodeMirror.
//   - Bottom panel: terminal / output / problems tabs.
//
// On screens < 860px the side panel slides over the editor, and the
// activity bar moves to the bottom as a fixed tab strip (thumb-reach
// friendly). The editor uses CodeMirror's touch-aware selection handles.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FileExplorer from './components/FileExplorer';
import Terminal from './components/Terminal';
import GitPanel from './components/GitPanel';
import SearchPanel from './components/SearchPanel';
import DebugPanel from './components/DebugPanel';
import ProjectsPanel from './components/ProjectsPanel';
import ExtensionsPanel from './components/ExtensionsPanel';
import DrivePanel from './components/DrivePanel';
import CollabPanel from './components/CollabPanel';
import CommandPalette from './components/CommandPalette';
import ThemePicker from './components/ThemePicker';
import AIChatPanel from './components/AIChatPanel';
import CodeEditor, { EditorHandle } from './components/Editor';
import { Glyph } from './components/Glyph';
import Heartbeat from './components/Heartbeat';
import SaveIndicator from './components/SaveIndicator';
import ErrorBoundary from './components/ErrorBoundary';
import Cockpit from './cockpit/Cockpit';
import MobileKeybar from './components/MobileKeybar';
import { useAutosave } from './hooks/useAutosave';
import { GlyphName } from './lib/glyphs';
import {
  ROOT,
  ensureRoot,
  exists,
  join,
  readText,
  seedFromRecord,
  writeText,
} from './lib/fs';
import { localRead, localWrite, localWorkspaceInfo, QUICK_LOCATIONS } from './lib/localfs';
import { kvGet, kvSet, kvDel } from './lib/kv';
import { BUILTIN_THEMES, Theme, applyTheme } from './lib/themes';
import * as ext from './lib/extensions';
import { Breakpoint } from './lib/debugger';
import { Collab, CollabPeer } from './lib/collab';
import {
  formatJson,
  normalizeWhitespace,
  renameIdentifier,
  extractToFunction,
  toggleLineComment,
} from './lib/refactor';

type Activity =
  | 'files'
  | 'search'
  | 'git'
  | 'debug'
  | 'drive'
  | 'ext'
  | 'projects'
  | 'collab'
  | 'ai';

type Tab = { path: string; dirty: boolean };

type Workspace = {
  type: 'virtual' | 'local';
  path: string;
  name: string;
};

const SEED_PROJECT: Record<string, string> = {
  'README.md':
    '# Welcome to the Mobile Web IDE\n\nThis project is stored in your browser. Edit files on the left, run them from the Debug panel, and use the Git panel to commit & push to GitHub.\n',
  'src/main.js':
    "// Try editing this file, then press 'Run' in the Debug panel.\nfunction greet(name) {\n  return 'Hello, ' + name + '!';\n}\n\nconsole.log(greet('mobile IDE'));\n",
  'src/util.py': 'def add(a, b):\n    return a + b\n\nprint(add(2, 3))\n',
  'src/index.html':
    '<!doctype html>\n<html>\n  <head><title>Sample</title></head>\n  <body><h1>Hello!</h1></body>\n</html>\n',
  '.gitignore': 'node_modules/\ndist/\n.env\n',
  'package.json':
    '{\n  "name": "sample-project",\n  "version": "0.1.0",\n  "private": true\n}\n',
};

function randomColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 70%, 55%)`;
}

export default function App() {
  const [projectDir, setProjectDir] = useState<string>(join(ROOT, 'sample'));
  const [cockpitMode, setCockpitMode] = useState<boolean>(
    () => typeof window !== 'undefined' && window.location.hash.startsWith('#/cockpit'),
  );
  useEffect(() => {
    const sync = (): void => {
      if (window.location.hash.startsWith('#/cockpit')) setCockpitMode(true);
    };
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string | undefined>();
  const [tree, setTree] = useState(0);
  const [activity, setActivity] = useState<Activity>('files');
  const [sideOpen, setSideOpen] = useState(true);
  const [bottomOpen, setBottomOpen] = useState(false);
  const [bottomTab, setBottomTab] = useState<'terminal' | 'debug' | 'problems'>('terminal');
  const [theme, setTheme] = useState<Theme>(BUILTIN_THEMES[0]);
  const [themes, setThemes] = useState<Theme[]>(BUILTIN_THEMES);
  const [palOpen, setPalOpen] = useState(false);
  const [cmds, setCmds] = useState<ext.IdeCommand[]>([]);
  const [breakpoints, setBreakpoints] = useState<Breakpoint[]>([]);
  const [notification, setNotification] = useState<string | null>(null);
  const [localRoot, setLocalRoot] = useState<string | null>(null);
  const [docs, setDocs] = useState<Record<string, string>>({});
  const editorRef = useRef<EditorHandle | null>(null);
  const collabRef = useRef<Collab | null>(null);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [recentWorkspaces, setRecentWorkspaces] = useState<Workspace[]>([]);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [customPath, setCustomPath] = useState('');
  const [homeDir, setHomeDir] = useState<string | null>(null);

  const bootedRef = useRef(false);
  const author = useMemo(
    () => ({ name: 'Mobile IDE User', email: 'user@webide.local' }),
    [],
  );
  const me: CollabPeer = useMemo(() => {
    const id = crypto.getRandomValues(new Uint32Array(2)).join('-');
    return { id, name: 'You', color: randomColor(id) };
  }, []);

  // --- boot ---
  useEffect(() => {
    (async () => {
      await ensureRoot();
      // Seed sample project on first run.
      const sample = join(ROOT, 'sample');
      if (!(await exists(sample))) {
        await seedFromRecord(sample, SEED_PROJECT);
      }

      // Fetch home dir for path resolution.
      try {
        const hr = await fetch('/api/fs/home');
        if (hr.ok) { const hd = await hr.json(); if (hd?.home) setHomeDir(hd.home); }
      } catch {}

      // Restore workspace state.
      const recent = (await kvGet<Workspace[]>('recent.workspaces')) || [];
      setRecentWorkspaces(recent);
      const lastWs = await kvGet<Workspace>('last.workspace');
      if (lastWs) {
        if (lastWs.type === 'local') {
          try {
            await localWorkspaceInfo(lastWs.path);
            setLocalRoot(lastWs.path);
            setWorkspace(lastWs);
          } catch {
            // Folder gone — fall through to virtual FS default.
            const fallback = (await kvGet<string>('last.projectDir')) || sample;
            setProjectDir((await exists(fallback)) ? fallback : sample);
          }
        } else {
          if (await exists(lastWs.path)) {
            setProjectDir(lastWs.path);
            setWorkspace(lastWs);
          } else {
            const fallback = (await kvGet<string>('last.projectDir')) || sample;
            setProjectDir((await exists(fallback)) ? fallback : sample);
          }
        }
      } else {
        // Legacy: restore from projectDir key.
        const lastDir = (await kvGet<string>('last.projectDir')) || sample;
        setProjectDir((await exists(lastDir)) ? lastDir : sample);
      }

      const savedThemeId = (await kvGet<string>('theme.id')) || 'dark';
      const t = BUILTIN_THEMES.find((x) => x.id === savedThemeId) || BUILTIN_THEMES[0];
      applyTheme(t);
      setTheme(t);

      // Wire extensions API IO & notifier.
      ext.wireIO({
        readFile: (p) => readText(p),
        writeFile: (p, d) => writeText(p, d),
      });
      ext.setNotifier((msg) => setNotification(msg));

      await registerBuiltinCommands();
      await ext.activateEnabled();
      refreshCommands();

      setThemes(ext.host.listThemes());
      bootedRef.current = true;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    kvSet('last.projectDir', projectDir);
    setTabs([]);
    setActive(undefined);
  }, [projectDir]);

  // Persist workspace + recent list whenever they change.
  useEffect(() => {
    if (!bootedRef.current) return;
    if (workspace) kvSet('last.workspace', workspace);
    kvSet('recent.workspaces', recentWorkspaces.slice(0, 20));
  }, [workspace, recentWorkspaces]);

  useEffect(() => {
    (window as any).__WEBIDE_ACTIVE_PATH = active;
  }, [active]);

  // --- tabs / open ---
  const isLocalFile = useCallback(
    (p: string) => !!localRoot && p.startsWith(localRoot),
    [localRoot],
  );

  const openPath = useCallback(
    async (path: string, line?: number) => {
      let text: string;
      if (isLocalFile(path)) {
        text = await localRead(path);
      } else {
        if (!(await exists(path))) return;
        text = await readText(path);
      }
      setDocs((d) => ({ ...d, [path]: text }));
      setTabs((t) => (t.find((x) => x.path === path) ? t : [...t, { path, dirty: false }]));
      setActive(path);
      // If requested, jump to line after the editor mounts.
      if (line) {
        setTimeout(() => {
          const view = editorRef.current?.view();
          if (view) {
            const ln = Math.max(1, Math.min(line, view.state.doc.lines));
            const pos = view.state.doc.line(ln).from;
            view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
            view.focus();
          }
        }, 80);
      }
      ext.host.emit('fileOpened', { path });
    },
    [isLocalFile],
  );

  const closeTab = useCallback(
    (path: string) => {
      setTabs((t) => t.filter((x) => x.path !== path));
      setActive((cur) => (cur === path ? undefined : cur));
    },
    [],
  );

  // --- workspace management ---
  function resolvePath(p: string): string {
    if (!homeDir) return p;
    if (p === '~') return homeDir;
    if (p.startsWith('~/')) return homeDir + p.slice(1);
    return p;
  }

  const openWorkspace = useCallback((type: 'virtual' | 'local', path: string) => {
    const name = path.split('/').pop() || path;
    const ws: Workspace = { type, path, name };
    setWorkspace(ws);
    if (type === 'local') {
      setLocalRoot(path);
    } else {
      setLocalRoot(null);
      setProjectDir(path);
    }
    setTabs([]);
    setActive(undefined);
    setRecentWorkspaces((prev) => {
      const filtered = prev.filter((w) => !(w.path === path && w.type === type));
      return [ws, ...filtered].slice(0, 20);
    });
  }, []);

  const closeWorkspace = useCallback(() => {
    setWorkspace(null);
    setLocalRoot(null);
    const sample = join(ROOT, 'sample');
    setProjectDir(sample);
    setTabs([]);
    setActive(undefined);
    kvDel('last.workspace');
  }, []);

  async function handleOpenFolder(rawPath: string) {
    const p = resolvePath(rawPath);
    setFolderPickerOpen(false);
    try {
      const info = await localWorkspaceInfo(p);
      openWorkspace('local', p);
      setNotification(`Opened folder: ${info.name}${info.hasGit ? ' (git)' : ''}`);
    } catch (err) {
      setNotification(`Cannot open folder: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function handleOpenCustomFolder() {
    const p = customPath.trim();
    if (p) {
      setCustomPath('');
      handleOpenFolder(p);
    }
  }

  function removeRecentWorkspace(path: string) {
    setRecentWorkspaces((prev) => prev.filter((w) => w.path !== path));
  }

  const onChange = useCallback(
    (text: string) => {
      if (!active) return;
      setDocs((d) => ({ ...d, [active]: text }));
      setTabs((t) =>
        t.map((x) => (x.path === active ? { ...x, dirty: true } : x)),
      );
      collabRef.current?.broadcastDoc(active, text);
    },
    [active],
  );

  const onCursor = useCallback(
    (line: number, col: number) => {
      setCursor({ line, col });
      if (active) collabRef.current?.broadcastCursor(active, line, col);
    },
    [active],
  );

  const onIncomingDoc = useCallback(
    async (path: string, text: string) => {
      if (await exists(path)) {
        await writeText(path, text);
      }
      setDocs((d) => ({ ...d, [path]: text }));
      if (active === path) editorRef.current?.setDoc(text);
      setTree((k) => k + 1);
    },
    [active],
  );

  // Shared write routing used by both explicit save and autosave.
  const persistFile = useCallback(
    async (path: string, text: string): Promise<void> => {
      if (isLocalFile(path)) {
        await localWrite(path, text); // may throw on permission/path errors
      } else {
        await writeText(path, text); // virtual FS — effectively never throws
      }
      setTabs((t) => t.map((x) => (x.path === path ? { ...x, dirty: false } : x)));
      ext.host.emit('fileSaved', { path });
    },
    [isLocalFile],
  );

  async function saveActive(): Promise<void> {
    if (!active) return;
    const text = editorRef.current?.getDoc() ?? docs[active] ?? '';
    try {
      await persistFile(active, text);
      setNotification('Saved ' + active);
    } catch (err) {
      setNotification('Save failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  // --- theme ---
  async function pickTheme(t: Theme): Promise<void> {
    setTheme(t);
    applyTheme(t);
    await kvSet('theme.id', t.id);
  }

  // --- commands ---
  function refreshCommands() {
    setCmds(ext.host.listCommands());
    setThemes(ext.host.listThemes());
  }

  async function registerBuiltinCommands() {
    ext.host.registerCommand({
      id: 'file.save',
      title: 'File: Save active file',
      category: 'File',
      run: saveActive,
    });
    ext.host.registerCommand({
      id: 'file.format',
      title: 'File: Format',
      category: 'File',
      run: () => {
        if (!active) return;
        const text = editorRef.current?.getDoc() ?? '';
        const formatted = active.endsWith('.json')
          ? formatJson(text)
          : normalizeWhitespace(text);
        editorRef.current?.setDoc(formatted);
      },
    });
    ext.host.registerCommand({
      id: 'edit.rename',
      title: 'Refactor: Rename identifier',
      category: 'Refactor',
      run: () => {
        if (!active) return;
        const oldName = prompt('Rename what identifier?');
        if (!oldName) return;
        const newName = prompt('Rename to:');
        if (!newName) return;
        const text = editorRef.current?.getDoc() ?? '';
        editorRef.current?.setDoc(renameIdentifier(text, oldName, newName));
      },
    });
    ext.host.registerCommand({
      id: 'edit.extractFunction',
      title: 'Refactor: Extract selection to function',
      category: 'Refactor',
      run: () => {
        const view = editorRef.current?.view();
        if (!view) return;
        const name = prompt('Function name:', 'extracted');
        if (!name) return;
        extractToFunction(view, name);
      },
    });
    ext.host.registerCommand({
      id: 'edit.toggleComment',
      title: 'Edit: Toggle line comment',
      category: 'Edit',
      run: () => {
        const view = editorRef.current?.view();
        if (view) toggleLineComment(view);
      },
    });
    ext.host.registerCommand({
      id: 'edit.find',
      title: 'Edit: Find in file',
      category: 'Edit',
      run: () => editorRef.current?.openSearch(),
    });
    ext.host.registerCommand({
      id: 'view.terminal',
      title: 'View: Toggle terminal',
      category: 'View',
      run: () => {
        setBottomTab('terminal');
        setBottomOpen((x) => !x);
      },
    });
    ext.host.registerCommand({
      id: 'view.debug',
      title: 'View: Toggle debug console',
      category: 'View',
      run: () => {
        setBottomTab('debug');
        setBottomOpen((x) => !x);
      },
    });
    ext.host.registerCommand({
      id: 'view.theme.next',
      title: 'View: Next theme',
      category: 'View',
      run: () => {
        const list = ext.host.listThemes();
        const idx = list.findIndex((t) => t.id === theme.id);
        const next = list[(idx + 1) % list.length];
        pickTheme(next);
      },
    });
    ext.host.registerCommand({
      id: 'workspace.openFolder',
      title: 'Workspace: Open folder',
      category: 'Workspace',
      run: () => setFolderPickerOpen(true),
    });
    ext.host.registerCommand({
      id: 'workspace.close',
      title: 'Workspace: Close folder',
      category: 'Workspace',
      run: closeWorkspace,
    });
  }

  // --- breakpoints ---
  function toggleBreakpoint(bp: Breakpoint) {
    setBreakpoints((cur) => {
      const idx = cur.findIndex((b) => b.path === bp.path && b.line === bp.line);
      if (idx >= 0) {
        const next = [...cur];
        next.splice(idx, 1);
        return next;
      }
      return [...cur, bp];
    });
  }

  const activeDoc = active ? docs[active] ?? '' : '';

  // Dev-only error-boundary test hook. Call `window.__crashPanel('side')`
  // or `__crashPanel('editor')` or `__crashPanel('bottom')` in DevTools to
  // force a render-time throw in the named scope so you can confirm the
  // boundary contains it. Tree-shaken out of production builds.
  const [crashedScopes, setCrashedScopes] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __crashPanel?: (s: string) => void }).__crashPanel = (scope: string) => {
      setCrashedScopes((prev) => new Set(prev).add(scope));
    };
    (window as unknown as { __healPanel?: (s: string) => void }).__healPanel = (scope: string) => {
      setCrashedScopes((prev) => {
        const next = new Set(prev);
        next.delete(scope);
        return next;
      });
    };
    return () => {
      delete (window as unknown as { __crashPanel?: unknown }).__crashPanel;
      delete (window as unknown as { __healPanel?: unknown }).__healPanel;
    };
  }, []);
  const Crasher = ({ scope }: { scope: string }): null => {
    if (import.meta.env.DEV && crashedScopes.has(scope)) {
      throw new Error('[__crashPanel] forced crash: ' + scope);
    }
    return null;
  };

  // Debounced autosave — 500ms after last keystroke. Local-FS writes
  // may fail (permission, disk, bad path); virtual-FS writes are
  // effectively fire-and-forget.
  const autosave = useAutosave(active, activeDoc, persistFile, 500);

  const activityItems: ReadonlyArray<{ id: Activity; glyph: GlyphName; label: string; title: string }> = [
    { id: 'files',    glyph: 'files',    label: 'FS', title: 'Files' },
    { id: 'search',   glyph: 'search',   label: 'SR', title: 'Search' },
    { id: 'git',      glyph: 'git',      label: 'GT', title: 'Source control' },
    { id: 'debug',    glyph: 'debug',    label: 'RN', title: 'Run & debug' },
    { id: 'drive',    glyph: 'drive',    label: 'DR', title: 'Drive' },
    { id: 'ext',      glyph: 'ext',      label: 'EX', title: 'Extensions' },
    { id: 'projects', glyph: 'projects', label: 'PJ', title: 'Projects' },
    { id: 'collab',   glyph: 'collab',   label: 'CO', title: 'Collaboration' },
    { id: 'ai',       glyph: 'ai',       label: 'AI', title: 'AI Assistant' },
  ];

  const projectRel = projectDir.replace(ROOT + '/', '');
  const crumbs = projectRel.split('/').filter(Boolean);
  const crumbClass = (i: number) => ['crumb-a', 'crumb-b', 'crumb-c'][i % 3];
  const workspaceLabel = workspace
    ? (workspace.type === 'local' ? workspace.name : workspace.path.split('/').pop() || workspace.path)
    : null;

  if (cockpitMode) {
    return (
      <ErrorBoundary label="cockpit">
        <Cockpit
          onExitToIde={() => {
            setCockpitMode(false);
            if (window.location.hash.startsWith('#/cockpit')) window.location.hash = '';
          }}
        />
      </ErrorBoundary>
    );
  }

  return (
    <div className="ide" data-theme={theme.id}>
      {/* top bar */}
      <header className="topbar">
        <button
          className="icon-btn"
          onClick={() => setSideOpen((x) => !x)}
          title="Toggle side panel"
        >
          <Glyph name="menu" />
        </button>
        <div className="brand" title="Mobile Web IDE">
          <span className="brand-mark"><Glyph name="bolt" /></span>
          <span className="brand-text">
            <span>MW</span>
            <span className="brand-dim">IDE</span>
          </span>
        </div>
        <div className="topbar-project" title={workspaceLabel || projectRel}>
          {workspace ? (
            <span
              className="crumb-a"
              style={{ cursor: 'pointer' }}
              onClick={() => setFolderPickerOpen(true)}
            >
              <Glyph name="folder_open" /> {workspaceLabel}
            </span>
          ) : crumbs.length === 0 ? (
            <span className="crumb-a">~</span>
          ) : (
            crumbs.map((c, i) => (
              <span key={i}>
                {i > 0 && <span className="crumb-sep">/</span>}
                <span className={crumbClass(i)}>{c}</span>
              </span>
            ))
          )}
        </div>
        <button
          className="icon-btn"
          onClick={() => setFolderPickerOpen(true)}
          title="Open folder"
        >
          <Glyph name="folder_open" />
        </button>
        <div className="topbar-spacer" />
        <button
          className="icon-btn"
          style={{ width: 'auto', padding: '0 10px', fontWeight: 600 }}
          onClick={() => {
            setCockpitMode(true);
            if (!window.location.hash.startsWith('#/cockpit')) window.location.hash = '#/cockpit';
          }}
          title="Open Cockpit mode"
        >
          Cockpit
        </button>
        <ThemePicker themes={themes} current={theme.id} onPick={pickTheme} />
        <button className="icon-btn" onClick={() => setPalOpen(true)} title="Command palette">
          <Glyph name="palette" />
        </button>
        <button
          className="icon-btn"
          onClick={() => setBottomOpen((x) => !x)}
          title="Toggle terminal"
        >
          <Glyph name="bottom" />
        </button>
        <button className="icon-btn" onClick={saveActive} title="Save" disabled={!active}>
          <Glyph name="save" />
        </button>
      </header>

      <div className="workbench">
        {/* activity bar */}
        <nav className="activity-bar">
          {activityItems.map((it) => (
            <button
              key={it.id}
              className={activity === it.id ? 'active' : ''}
              onClick={() => {
                setActivity(it.id);
                setSideOpen(true);
              }}
              title={it.title}
            >
              <Glyph name={it.glyph} />
              <span className="slot-label">{it.label}</span>
            </button>
          ))}
        </nav>

        {/* side panel — each activity wrapped in its own boundary so
            a crash in one panel can't take down the IDE. */}
        <aside className={'side-panel ' + (sideOpen ? 'open' : 'closed')}>
          <ErrorBoundary label={'Side panel: ' + activity} resetKey={activity}>
            <Crasher scope="side" />
            {activity === 'files' && (
              <FileExplorer
                root={projectDir}
                activePath={active}
                onOpen={openPath}
                onChange={() => setTree((k) => k + 1)}
                refreshKey={tree}
                localRoot={localRoot}
                onLocalRootChange={(path) => {
                  if (path) {
                    openWorkspace('local', path);
                  } else {
                    closeWorkspace();
                  }
                }}
              />
            )}
            {activity === 'search' && (
              <SearchPanel projectDir={projectDir} onOpen={(p, l) => openPath(p, l)} />
            )}
            {activity === 'git' && (
              <GitPanel
                projectDir={projectDir}
                onProjectChanged={setProjectDir}
                onRefresh={() => setTree((k) => k + 1)}
                author={author}
              />
            )}
            {activity === 'debug' && (
              <DebugPanel
                activePath={active}
                getActiveSource={() => editorRef.current?.getDoc() ?? ''}
                breakpoints={breakpoints}
                onToggleBreakpoint={toggleBreakpoint}
              />
            )}
            {activity === 'drive' && (
              <DrivePanel
                projectDir={projectDir}
                activePath={active}
                onRefresh={() => setTree((k) => k + 1)}
              />
            )}
            {activity === 'ext' && <ExtensionsPanel onRefreshCommands={refreshCommands} />}
            {activity === 'projects' && (
              <ProjectsPanel
                projectDir={projectDir}
                onOpen={(dir) => openWorkspace('virtual', dir)}
                onOpenLocalFolder={() => setFolderPickerOpen(true)}
                recentWorkspaces={recentWorkspaces}
                onOpenWorkspace={(ws) => openWorkspace(ws.type, ws.path)}
                onRemoveWorkspace={removeRecentWorkspace}
              />
            )}
            {activity === 'collab' && (
              <CollabPanel
                projectDir={projectDir}
                me={me}
                onDocIncoming={onIncomingDoc}
                onCursor={() => {}}
                bindOut={(c) => (collabRef.current = c)}
              />
            )}
            {activity === 'ai' && (
              <AIChatPanel
                projectDir={projectDir}
                openFiles={tabs.map((t) => t.path)}
                onFileChanged={() => setTree((k) => k + 1)}
              />
            )}
          </ErrorBoundary>
        </aside>

        {/* editor area */}
        <main className="editor-area">
          <div className="tabs">
            {tabs.map((t) => (
              <div
                key={t.path}
                className={'tab ' + (t.path === active ? 'active' : '')}
                onClick={() => setActive(t.path)}
              >
                <span className="tab-name">
                  {t.path.split('/').pop()}
                  {t.dirty && <span className="tab-dirty" aria-label="unsaved" />}
                </span>
                <button
                  className="tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(t.path);
                  }}
                  title="Close"
                >
                  <Glyph name="close" />
                </button>
              </div>
            ))}
            {tabs.length === 0 && (
              <div className="tab placeholder">no file open — open one from the file tree</div>
            )}
          </div>
          <div className="editor-wrap">
            {active ? (
              <ErrorBoundary label="Editor" resetKey={active}>
                <Crasher scope="editor" />
                <CodeEditor
                  key={active}
                  path={active}
                  initialDoc={activeDoc}
                  theme={theme}
                  onChange={onChange}
                  onCursor={onCursor}
                  onRef={(h) => (editorRef.current = h)}
                />
              </ErrorBoundary>
            ) : (
              <div className="empty-editor">
                <h2>Mobile Web IDE</h2>
                <p className="tagline">// a terminal-native development surface</p>
                <button
                  className="welcome-open-folder"
                  onClick={() => setFolderPickerOpen(true)}
                >
                  <Glyph name="folder_open" /> Open Folder
                </button>
                {recentWorkspaces.length > 0 && (
                  <div className="welcome-recent">
                    <h3>Recent</h3>
                    {recentWorkspaces.slice(0, 8).map((ws) => (
                      <button
                        key={ws.type + ':' + ws.path}
                        className="welcome-recent-item"
                        onClick={() => openWorkspace(ws.type, ws.path)}
                      >
                        <span className="welcome-recent-name">
                          <Glyph name={ws.type === 'local' ? 'folder_open' : 'files'} /> {ws.name}
                        </span>
                        <span className="welcome-recent-path">{ws.path}</span>
                      </button>
                    ))}
                  </div>
                )}
                <ul>
                  <li><Glyph name="files"    /><b>Files</b>       <span>explore &amp; edit</span></li>
                  <li><Glyph name="search"   /><b>Search</b>      <span>find in files, symbols, references</span></li>
                  <li><Glyph name="git"      /><b>Source</b>      <span>clone, commit, push, branch</span></li>
                  <li><Glyph name="debug"    /><b>Run</b>         <span>breakpoints, logs, step</span></li>
                  <li><Glyph name="drive"    /><b>Drive</b>       <span>import / export with Google Drive</span></li>
                  <li><Glyph name="ext"      /><b>Extensions</b>  <span>install custom JS extensions</span></li>
                  <li><Glyph name="projects" /><b>Projects</b>    <span>create, switch, manage tasks</span></li>
                  <li><Glyph name="collab"   /><b>Collab</b>      <span>realtime edit with peers</span></li>
                  <li><Glyph name="ai"       /><b>AI</b>          <span>in-line assistant for code &amp; chat</span></li>
                </ul>
              </div>
            )}
          </div>
          <div className="status-bar">
            <span className="st-branch" title="Brand"><Glyph name="bolt" /> MWIDE</span>
            <span className="st-path" title={active || 'no file'}>
              <span className="st-key">FILE</span>
              {active ? active.replace(projectDir + '/', '').replace(ROOT + '/', '~/') : '—'}
            </span>
            <span className="spacer" />
            <span className="st-pos"><span className="st-key">POS</span>{String(cursor.line).padStart(3, ' ')}:{String(cursor.col).padStart(3, ' ')}</span>
            <SaveIndicator state={autosave} />
            <span className="st-theme"><span className="st-key">THEME</span>{theme.label}</span>
            <span className="st-heart" title="Event pulse"><Heartbeat /></span>
          </div>
        </main>
      </div>

      {/* bottom panel */}
      {bottomOpen && (
        <section className="bottom-panel">
          <div className="bottom-tabs">
            <button
              className={bottomTab === 'terminal' ? 'active' : ''}
              onClick={() => setBottomTab('terminal')}
            >
              TERMINAL
            </button>
            <button
              className={bottomTab === 'debug' ? 'active' : ''}
              onClick={() => setBottomTab('debug')}
            >
              DEBUG
            </button>
            <button
              className={bottomTab === 'problems' ? 'active' : ''}
              onClick={() => setBottomTab('problems')}
            >
              PROBLEMS
            </button>
            <span className="spacer" />
            <button onClick={() => setBottomOpen(false)} title="Collapse"><Glyph name="chevron_dn" /></button>
          </div>
          <div className="bottom-body">
            <ErrorBoundary label={'Bottom: ' + bottomTab} resetKey={bottomTab}>
              <Crasher scope="bottom" />
              {bottomTab === 'terminal' && (
                <Terminal projectDir={projectDir} author={author} />
              )}
              {bottomTab === 'debug' && (
                <DebugPanel
                  activePath={active}
                  getActiveSource={() => editorRef.current?.getDoc() ?? ''}
                  breakpoints={breakpoints}
                  onToggleBreakpoint={toggleBreakpoint}
                />
              )}
              {bottomTab === 'problems' && (
                <div className="problems">
                  <div className="muted">
                    Diagnostics shown inline in the editor gutter. Open the command palette and run
                    "Edit: Find in file" to scan for TODO/FIXME markers.
                  </div>
                </div>
              )}
            </ErrorBoundary>
          </div>
        </section>
      )}

      {/* Folder picker modal */}
      {folderPickerOpen && (
        <div className="fp-overlay" onClick={() => setFolderPickerOpen(false)}>
          <div className="fp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fp-header">
              <span><Glyph name="folder_open" /> Open Folder</span>
              <button className="icon-btn" onClick={() => setFolderPickerOpen(false)}>
                <Glyph name="close" />
              </button>
            </div>
            <div className="fp-section">
              <div className="fp-section-title">Quick Access</div>
              {QUICK_LOCATIONS.map((loc) => (
                <button
                  key={loc.path}
                  className="fp-item"
                  onClick={() => handleOpenFolder(loc.path)}
                >
                  <span className="fp-item-label">{loc.label}</span>
                  <span className="fp-item-path">{loc.path}</span>
                </button>
              ))}
              <div className="fp-custom-row">
                <input
                  className="fp-custom-input"
                  type="text"
                  placeholder="Custom path…"
                  value={customPath}
                  onChange={(e) => setCustomPath(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleOpenCustomFolder(); }}
                />
                <button className="fp-custom-go" onClick={handleOpenCustomFolder} disabled={!customPath.trim()}>
                  Open
                </button>
              </div>
            </div>
            {recentWorkspaces.length > 0 && (
              <div className="fp-section">
                <div className="fp-section-title">Recent</div>
                {recentWorkspaces.slice(0, 10).map((ws) => (
                  <button
                    key={ws.type + ':' + ws.path}
                    className="fp-item"
                    onClick={() => {
                      setFolderPickerOpen(false);
                      openWorkspace(ws.type, ws.path);
                    }}
                  >
                    <span className="fp-item-label">
                      <Glyph name={ws.type === 'local' ? 'folder_open' : 'files'} /> {ws.name}
                    </span>
                    <span className="fp-item-path">{ws.path}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      <CommandPalette
        open={palOpen}
        commands={cmds}
        onClose={() => setPalOpen(false)}
      />

      <MobileKeybar />

      {notification && (
        <div className="notification" onClick={() => setNotification(null)}>
          {notification}
        </div>
      )}
    </div>
  );
}
