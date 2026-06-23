import { useRef, useState } from 'react';
import { useCockpit } from '../Cockpit';
import { navigate, type CockpitRoute } from '../router';
import { refreshCockpit } from '../state';
import { vibrate } from '../haptics';
import { CockpitHome, RepoList, RepoDetail, RepoActions, RepoTerminal, CockpitSettings } from './pages';

function TabLink({ label, target, active }: { label: string; target: CockpitRoute; active: boolean }) {
  return (
    <button
      onClick={() => navigate(target)}
      className={`min-h-[52px] text-xs font-semibold ${active ? 'text-sky-400' : 'text-slate-400'}`}
    >
      {label}
    </button>
  );
}

export default function MobileCockpit() {
  const { onExitToIde, route } = useCockpit();
  const mainRef = useRef<HTMLElement | null>(null);
  const startY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);

  let page: React.ReactNode;
  switch (route.name) {
    case 'home':
      page = <CockpitHome />;
      break;
    case 'repos':
      page = <RepoList />;
      break;
    case 'repoDetail':
      page = <RepoDetail repoId={route.repoId} />;
      break;
    case 'repoActions':
      page = <RepoActions repoId={route.repoId} />;
      break;
    case 'repoTerminal':
      page = <RepoTerminal repoId={route.repoId} />;
      break;
    case 'settings':
      page = <CockpitSettings />;
      break;
    default:
      page = <CockpitHome />;
  }

  const reposActive =
    route.name === 'repos' || route.name === 'repoDetail' || route.name === 'repoActions' || route.name === 'repoTerminal';

  return (
    <div className="flex h-[100dvh] flex-col bg-slate-900 text-slate-100" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <header className="flex items-center justify-between border-b border-slate-700 px-2 py-2">
        <button onClick={onExitToIde} className="min-h-[44px] rounded-lg px-3 text-sm font-semibold text-sky-400">‹ IDE</button>
        <span className="text-sm font-bold">Cockpit</span>
        <button onClick={() => { vibrate(15); refreshCockpit(); }} className="min-h-[44px] rounded-lg px-3 text-lg text-slate-300" title="Refresh">↻</button>
      </header>
      {pull > 0 && (
        <div className="flex items-center justify-center text-xs text-slate-400" style={{ height: pull }}>
          {pull > 60 ? 'Release to refresh' : 'Pull to refresh'}
        </div>
      )}
      <main
        ref={mainRef}
        className="flex-1 overflow-y-auto px-4 py-4"
        onTouchStart={(e) => {
          const el = mainRef.current;
          startY.current = el && el.scrollTop <= 0 ? e.touches[0].clientY : null;
        }}
        onTouchMove={(e) => {
          if (startY.current === null) return;
          const dy = e.touches[0].clientY - startY.current;
          if (dy > 0) setPull(Math.min(dy, 80));
        }}
        onTouchEnd={() => {
          if (pull > 60) {
            vibrate(15);
            refreshCockpit();
          }
          setPull(0);
          startY.current = null;
        }}
      >
        {page}
      </main>
      <nav className="grid grid-cols-3 border-t border-slate-700 bg-slate-800" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <TabLink label="Home" target={{ name: 'home' }} active={route.name === 'home'} />
        <TabLink label="Repos" target={{ name: 'repos' }} active={reposActive} />
        <TabLink label="Settings" target={{ name: 'settings' }} active={route.name === 'settings'} />
      </nav>
    </div>
  );
}
