// Cockpit entry: selects the device vertical at runtime and lazily code-splits
// the three trees (TVDS: each device downloads only its own presentation).
import { createContext, lazy, Suspense, useContext } from 'react';
import { useDeviceClass } from './device';
import type { DeviceClass } from './device';
import { useHashRoute } from './router';
import type { CockpitRoute } from './router';

const MobileCockpit = lazy(() => import('./mobile'));
const TabletCockpit = lazy(() => import('./tablet'));
const DesktopCockpit = lazy(() => import('./desktop'));

export interface CockpitCtx {
  onExitToIde: () => void;
  vertical: DeviceClass;
  route: CockpitRoute;
}

export const CockpitContext = createContext<CockpitCtx | null>(null);

export function useCockpit(): CockpitCtx {
  const ctx = useContext(CockpitContext);
  if (!ctx) throw new Error('useCockpit must be used within <Cockpit>');
  return ctx;
}

export default function Cockpit({ onExitToIde }: { onExitToIde: () => void }) {
  const vertical = useDeviceClass();
  const route = useHashRoute();
  const Active = vertical === 'mobile' ? MobileCockpit : vertical === 'tablet' ? TabletCockpit : DesktopCockpit;

  return (
    <CockpitContext.Provider value={{ onExitToIde, vertical, route }}>
      <Suspense fallback={<div className="p-6 text-sm text-slate-400">Loading cockpit…</div>}>
        <Active />
      </Suspense>
    </CockpitContext.Provider>
  );
}
