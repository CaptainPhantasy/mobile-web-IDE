// PWA registration. Registers the vite-plugin-pwa service worker,
// auto-updates it, and exposes an `install` promise the rest of the
// app can await for the "Install" UI.
//
// All logic behind feature detection so the bundle works on browsers
// without SW support (old iOS Safari, file://, etc.).

import { registerSW } from 'virtual:pwa-register';

export type InstallController = {
  /** True if the install prompt has fired and is available to trigger. */
  canInstall: () => boolean;
  /** Trigger the install prompt. Resolves to 'accepted' | 'dismissed'. */
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
  /** Subscribe to install-available state changes. */
  onChange: (fn: (canInstall: boolean) => void) => () => void;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BeforeInstallPromptEvent = any;

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const subscribers: Array<(b: boolean) => void> = [];
function fire(b: boolean): void { subscribers.forEach((fn) => fn(b)); }

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    fire(true);
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    fire(false);
  });
}

export const installController: InstallController = {
  canInstall: () => !!deferredPrompt,
  install: async () => {
    if (!deferredPrompt) return 'unavailable';
    try {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      deferredPrompt = null;
      fire(false);
      return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
    } catch {
      return 'dismissed';
    }
  },
  onChange: (fn) => {
    subscribers.push(fn);
    return () => {
      const i = subscribers.indexOf(fn);
      if (i >= 0) subscribers.splice(i, 1);
    };
  },
};

/** Register the service worker and wire an auto-update. Safe to call once. */
export function registerPwa(): void {
  if (typeof window === 'undefined') return;
  try {
    registerSW({
      immediate: true,
      onRegisteredSW() {
        // eslint-disable-next-line no-console
        console.log('[pwa] service worker registered');
      },
      onNeedRefresh() {
        // Vite-plugin-pwa autoUpdate handles the refresh itself; we
        // just emit a console breadcrumb so the user can see it if
        // they're looking.
        // eslint-disable-next-line no-console
        console.log('[pwa] update available — reload to apply');
      },
      onOfflineReady() {
        // eslint-disable-next-line no-console
        console.log('[pwa] app ready to work offline');
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pwa] registration failed', err);
  }
}
