import { useEffect } from 'react';
import { useCockpit } from '../Cockpit';
import { navigate } from '../router';
import { useRepos, refreshCockpit } from '../state';
import { SidebarRepoRow } from './components';
import { CockpitOverview, RepoDetail, RepoActions, RepoTerminal, CockpitSettings } from './pages';

export default function TabletCockpit() {
  const { onExitToIde, route } = useCockpit();
  const repos = useRepos();
  const activeRepoId =
    route.name === 'repoDetail' || route.name === 'repoActions' || route.name === 'repoTerminal' ? route.repoId : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
      if (typing) return;
      if (e.key === 'Escape' && activeRepoId) navigate({ name: 'repos' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeRepoId]);

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
      content = <CockpitOverview />;
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-slate-900 text-slate-100" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <header className="flex items-center justify-between border-b border-slate-700 px-4 py-2.5">
        <button onClick={onExitToIde} className="rounded-lg px-3 py-2 text-sm font-semibold text-sky-400 hover:bg-slate-800">‹ IDE</button>
        <span className="text-sm font-bold">Operations Cockpit</span>
        <div className="flex items-center gap-1">
          <button onClick={() => navigate({ name: 'settings' })} className="rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800">Settings</button>
          <button onClick={() => refreshCockpit()} className="rounded-lg px-3 py-2 text-lg text-slate-300 hover:bg-slate-800" title="Refresh">↻</button>
        </div>
      </header>
      <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        <aside className="max-h-48 shrink-0 overflow-y-auto border-b border-slate-700 p-3 lg:max-h-none lg:w-80 lg:border-b-0 lg:border-r" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <button onClick={() => navigate({ name: 'home' })} className={`mb-1 block w-full rounded-lg px-3 py-2 text-left text-sm ${route.name === 'home' || route.name === 'repos' ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-700/70'}`}>Overview</button>
          <div className="mb-1 mt-3 px-3 text-xs uppercase tracking-wide text-slate-500">Repositories</div>
          {repos.loading ? (
            <div className="px-3 py-2 text-xs text-slate-500">Loading…</div>
          ) : repos.error ? (
            <div className="px-3 py-2 text-xs text-red-400">{repos.error}</div>
          ) : (repos.data ?? []).length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-500">No repositories configured.</div>
          ) : (
            (repos.data ?? []).map((r) => <SidebarRepoRow key={r.id} id={r.id} label={r.label} active={activeRepoId === r.id} />)
          )}
        </aside>
        <main className="flex-1 overflow-y-auto p-6" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {content}
        </main>
      </div>
    </div>
  );
}
