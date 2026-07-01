// Capability-first device classification (TVDS). Width is a tiebreaker only.
// A touchscreen laptop (fine pointer + hover) classifies as desktop, never tablet.
import { useEffect, useState } from 'react';

export type DeviceClass = 'mobile' | 'tablet' | 'desktop';
export type VerticalChoice = DeviceClass | 'auto';

const OVERRIDE_KEY = 'mwide:cockpit:vertical';
const OVERRIDE_EVENT = 'mwide:vertical-change';

export type DeviceSnapshot = {
  width: number;
  height: number;
  platform: string;
  userAgent: string;
  maxTouchPoints: number;
  finePointer: boolean;
  coarsePointer: boolean;
  hover: boolean;
};

function deviceSnapshot(win: Window): DeviceSnapshot {
  const mm = (q: string): boolean => typeof win.matchMedia === 'function' && win.matchMedia(q).matches;
  const nav = win.navigator;
  return {
    width: win.innerWidth || 1024,
    height: win.innerHeight || 768,
    platform: nav?.platform ?? '',
    userAgent: nav?.userAgent ?? '',
    maxTouchPoints: typeof nav?.maxTouchPoints === 'number' ? nav.maxTouchPoints : 0,
    finePointer: mm('(pointer: fine)'),
    coarsePointer: mm('(pointer: coarse)'),
    hover: mm('(hover: hover)'),
  };
}

export function classifyDeviceSnapshot(device: DeviceSnapshot): DeviceClass {
  const minDim = Math.min(device.width || 1024, device.height || 768);
  const ua = device.userAgent;
  const platform = device.platform;
  const isPhone =
    /\b(iPhone|iPod)\b/i.test(ua) ||
    /\bAndroid\b/i.test(ua) && /\bMobile\b/i.test(ua);
  const isTablet =
    /\biPad\b/i.test(ua) ||
    /\bAndroid\b/i.test(ua) && !/\bMobile\b/i.test(ua);
  const isIPadOSMacShim = device.maxTouchPoints > 1 && /Mac/.test(platform);

  // Mobile browser descriptors can expose desktop-like pointer media in automation.
  if (isPhone) return 'mobile';

  // iPadOS Safari reports a Mac platform. Keep it tablet unless split view is phone narrow.
  if (isTablet || isIPadOSMacShim) return minDim < 600 ? 'mobile' : 'tablet';

  // Fine pointer + hover is the desktop signal for real desktops and touch laptops.
  if (device.finePointer && device.hover) return 'desktop';

  const touchPrimary = device.coarsePointer || device.maxTouchPoints > 1;
  if (touchPrimary) return minDim < 600 ? 'mobile' : 'tablet';

  if (minDim < 600) return 'mobile';
  if (minDim < 1024) return 'tablet';
  return 'desktop';
}

export function classifyDevice(win: Window = window): DeviceClass {
  return classifyDeviceSnapshot(deviceSnapshot(win));
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
