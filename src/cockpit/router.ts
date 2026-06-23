// Hash-based cockpit routing. Chosen over pathname routing because the app is
// served under Vite base '/mwide/'; hashes are base-independent and need no
// server route changes.
import { useEffect, useState } from 'react';

export type CockpitRoute =
  | { name: 'home' }
  | { name: 'repos' }
  | { name: 'settings' }
  | { name: 'repoDetail'; repoId: string }
  | { name: 'repoActions'; repoId: string }
  | { name: 'repoTerminal'; repoId: string };

export function parseCockpitRoute(hash: string): CockpitRoute {
  const parts = hash.replace(/^#/, '').split('/').filter((p) => p.length > 0);
  if (parts[0] !== 'cockpit') return { name: 'home' };
  if (parts[1] === 'repos' && parts[2]) {
    const repoId = decodeURIComponent(parts[2]);
    if (parts[3] === 'actions') return { name: 'repoActions', repoId };
    if (parts[3] === 'terminal') return { name: 'repoTerminal', repoId };
    return { name: 'repoDetail', repoId };
  }
  if (parts[1] === 'repos') return { name: 'repos' };
  if (parts[1] === 'settings') return { name: 'settings' };
  return { name: 'home' };
}

export function cockpitHref(route: CockpitRoute): string {
  switch (route.name) {
    case 'home':
      return '#/cockpit';
    case 'repos':
      return '#/cockpit/repos';
    case 'settings':
      return '#/cockpit/settings';
    case 'repoDetail':
      return `#/cockpit/repos/${encodeURIComponent(route.repoId)}`;
    case 'repoActions':
      return `#/cockpit/repos/${encodeURIComponent(route.repoId)}/actions`;
    case 'repoTerminal':
      return `#/cockpit/repos/${encodeURIComponent(route.repoId)}/terminal`;
  }
}

export function navigate(route: CockpitRoute): void {
  window.location.hash = cockpitHref(route);
}

export function useHashRoute(): CockpitRoute {
  const [route, setRoute] = useState<CockpitRoute>(() => parseCockpitRoute(window.location.hash));
  useEffect(() => {
    const onHash = (): void => setRoute(parseCockpitRoute(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}
