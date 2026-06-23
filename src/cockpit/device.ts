// Capability-first device classification (TVDS). Width is a tiebreaker only.
// A touchscreen laptop (fine pointer + hover) classifies as desktop, never tablet.
import { useEffect, useState } from 'react';

export type DeviceClass = 'mobile' | 'tablet' | 'desktop';
export type VerticalChoice = DeviceClass | 'auto';

const OVERRIDE_KEY = 'mwide:cockpit:vertical';
const OVERRIDE_EVENT = 'mwide:vertical-change';

export function classifyDevice(win: Window = window): DeviceClass {
  const mm = (q: string): boolean => typeof win.matchMedia === 'function' && win.matchMedia(q).matches;
  const finePointer = mm('(pointer: fine)');
  const hover = mm('(hover: hover)');
  // 1. Fine pointer + hover => desktop, even when touch is also present.
  if (finePointer && hover) return 'desktop';

  const nav = win.navigator;
  const touchPoints = nav && typeof nav.maxTouchPoints === 'number' ? nav.maxTouchPoints : 0;
  // 3. iPad shim: iPadOS Safari reports as macOS but exposes touch points.
  if (touchPoints > 1 && /Mac/.test(nav?.platform ?? '')) return 'tablet';

  const minDim = Math.min(win.innerWidth || 1024, win.innerHeight || 768);
  const touchPrimary = mm('(pointer: coarse)') || touchPoints > 1;
  // 2. Touch-primary => split by smallest viewport dimension.
  if (touchPrimary) return minDim < 600 ? 'mobile' : 'tablet';

  // 4. Width fallback.
  if (minDim < 600) return 'mobile';
  if (minDim < 1024) return 'tablet';
  return 'desktop';
}

export function getOverride(): VerticalChoice {
  try {
    const v = localStorage.getItem(OVERRIDE_KEY);
    if (v === 'mobile' || v === 'tablet' || v === 'desktop' || v === 'auto') return v;
  } catch {
    /* localStorage unavailable */
  }
  return 'auto';
}

export function setOverride(v: VerticalChoice): void {
  try {
    localStorage.setItem(OVERRIDE_KEY, v);
    window.dispatchEvent(new Event(OVERRIDE_EVENT));
  } catch {
    /* localStorage unavailable */
  }
}

export function useDeviceClass(): DeviceClass {
  const [cls, setCls] = useState<DeviceClass>(() => {
    const o = getOverride();
    return o === 'auto' ? classifyDevice() : o;
  });

  useEffect(() => {
    let timer = 0;
    const recompute = (): void => {
      const o = getOverride();
      const next = o === 'auto' ? classifyDevice() : o;
      setCls((prev) => (prev === next ? prev : next));
    };
    const onResize = (): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(recompute, 150);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    window.addEventListener(OVERRIDE_EVENT, recompute);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      window.removeEventListener(OVERRIDE_EVENT, recompute);
    };
  }, []);

  return cls;
}
