import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        // Generate the SW and manifest; include dev override so we can
        // test install + offline against `npm run dev`.
        devOptions: {
          enabled: true,
          type: 'module',
        },
        includeAssets: ['icon.svg', 'icon-maskable.svg', 'fonts/SymbolsNerdFontMono-Regular.ttf'],
        manifest: {
          name: 'Mobile Web IDE',
          short_name: 'MWIDE',
          description: 'Terminal-native web IDE with real PTY, git, and AI assistant.',
          theme_color: '#0a0d11',
          background_color: '#0a0d11',
          display: 'standalone',
          orientation: 'any',
          scope: '/',
          start_url: '/',
          id: '/',
          icons: [
            { src: '/icon.svg',          sizes: 'any',     type: 'image/svg+xml', purpose: 'any' },
            { src: '/icon-maskable.svg', sizes: 'any',     type: 'image/svg+xml', purpose: 'maskable' },
          ],
          categories: ['developer', 'productivity', 'utilities'],
          // Share target: accept text / URLs / single files from other
          // apps. POSTed to /share — the client intercepts and loads.
          share_target: {
            action: '/share',
            method: 'POST',
            enctype: 'multipart/form-data',
            params: {
              title: 'title',
              text:  'text',
              url:   'url',
              files: [
                { name: 'file', accept: ['text/*', 'application/json', 'application/xml'] },
              ],
            },
          },
        },
        workbox: {
          // App shell caching — default. Large bundle is acceptable here
          // since users install to run offline.
          globPatterns: ['**/*.{js,css,html,svg,ttf,woff,woff2,ico,png}'],
          maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
          // Never precache /api/* — those are dynamic.
          navigateFallbackDenylist: [/^\/api\//, /^\/ws\//],
          navigateFallback: '/index.html',
          runtimeCaching: [
            {
              // External fonts / CDN assets (we bundle ours, but just in case).
              urlPattern: ({ url }) => url.origin.startsWith('https://cdn.jsdelivr.net'),
              handler: 'StaleWhileRevalidate',
              options: { cacheName: 'cdn', expiration: { maxEntries: 32, maxAgeSeconds: 7 * 24 * 60 * 60 } },
            },
          ],
        },
      }),
    ],
    define: {
      'process.env.APP_URL': JSON.stringify(env.APP_URL || ''),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    optimizeDeps: {
      include: [
        '@codemirror/state',
        '@codemirror/view',
        '@codemirror/commands',
        '@codemirror/language',
        '@codemirror/autocomplete',
        '@codemirror/search',
        '@codemirror/lint',
        'isomorphic-git',
        '@isomorphic-git/lightning-fs',
        'idb',
      ],
    },
  };
});
