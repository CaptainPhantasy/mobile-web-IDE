import { useEffect, useRef, useState } from 'react';
import { useCockpit } from '../Cockpit';
import { navigate } from '../router';
import { useRepos, refreshCockpit } from '../state';
import { SidebarRepoRow } from './components';
import { CommandPalette } from './CommandPalette';
import { Overview, RepoDetail, RepoActions, RepoTerminal, CockpitSettings, InfoPanel } from './pages';

const RIGHT_KEY = 'mwide:cockpit:rightw';

export default function DesktopCockpit() {
  const { onExitToIde, route } = useCockpit();
  const repos = useRepos();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [rightW, setRightW] = useState<number>(() => {
    const v = Number(localStorage.getItem(RIGHT_KEY));
    return v >= 280 && v <= 720 ? v : 360;
  });
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const dragging = useRef(false);

  const activeRepoId =
    route.name === 'repoDetail' || route.name === 'repoActions' || route.name === 'repoTerminal' ? route.repoId : null;
  const showInfo = activeRepoId !== null && !rightCollapsed;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (e.key === 'Escape') {
        setPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const move = (e: MouseEvent): void => {
      if (!dragging.current) return;
      const w = window.innerWidth - e.clientX;
      setRightW(Math.min(720, Math.max(280, w)));
    };
    const up = (): void => {
      if (dragging.current) {
        dragging.current = false;
        try {
          localStorage.setItem(RIGHT_KEY, String(rightW));
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [rightW]);

  let content;
  switch (route.name) {
    case 'repoDetail':
      content = <RepoDetail repoId={route.repoId} />;
      break;
    case 'repoActions':
      content = <RepoActions repoId={route.repoId} />;
      break;
    case 'repoTerminal':
      content = <RepoTerminal repoId={route.repoId} />;
      break;
    case 'settings':
      content = <CockpitSettings />;
      break;
    default:
      content = <Overview />;
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-slate-900 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-700 px-4 py-2">
        <div className="flex items-center gap-2">
          <button onClick={onExitToIde} className="rounded-md px-3 py-1.5 text-sm font-semibold text-sky-400 hover:bg-slate-800">‹ IDE</button>
          <span className="text-sm font-bold">Operations Cockpit</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setPaletteOpen(true)} className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">⌘K Search</button>
          <button onClick={() => navigate({ name: 'settings' })} className="rounded-md px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">Settings</button>
          <button onClick={() => refreshCockpit()} className="rounded-md px-3 py-1.5 text-lg text-slate-300 hover:bg-slate-800" title="Refresh">↻</button>
          {activeRepoId && (
            <button onClick={() => setRightCollapsed((c) => !c)} className="rounded-md px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800" title="Toggle info panel">
              {rightCollapsed ? '▦' : '▥'}
            </button>
          )}
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-64 shrink-0 overflow-y-auto border-r border-slate-700 p-2">
          <button onClick={() => navigate({ name: 'home' })} className={`mb-1 block w-full rounded-md px-2 py-1.5 text-left text-sm ${route.name === 'home' || route.name === 'repos' ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-700/70'}`}>Overview</button>
          <div className="mb-1 mt-3 px-2 text-[11px] uppercase tracking-wide text-slate-500">Repositories</div>
          {repos.loading ? (
            <div className="px-2 py-1 text-xs text-slate-500">Loading…</div>
          ) : repos.error ? (
            <div className="px-2 py-1 text-xs text-red-400">{repos.error}</div>
          ) : (repos.data ?? []).length === 0 ? (
            <div className="px-2 py-1 text-xs text-slate-500">No repositories.</div>
          ) : (
            (repos.data ?? []).map((r) => <SidebarRepoRow key={r.id} id={r.id} label={r.label} active={activeRepoId === r.id} />)
          )}
        </aside>
        <main className="flex-1 overflow-y-auto p-6">{content}</main>
        {showInfo && activeRepoId && (
          <>
            <div onMouseDown={() => { dragging.current = true; }} className="w-1 shrink-0 cursor-col-resize bg-slate-700 hover:bg-sky-500" />
            <aside className="shrink-0 overflow-y-auto border-l border-slate-700 p-4" style={{ width: rightW }}>
              <InfoPanel repoId={activeRepoId} />
            </aside>
          </>
        )}
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} repos={repos.data ?? []} />
    </div>
  );
}
