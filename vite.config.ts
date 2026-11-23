import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { buildShiftIcs } from './src/lib/ics';
import { addDays, today } from './src/lib/date';

/** Emit /shifts.ics (base 4조 pattern, -60 .. +730 days) for iPhone calendar subscription. */
function shiftIcs(): Plugin {
  const make = () => buildShiftIcs(addDays(today(), -60), addDays(today(), 730), 60);
  return {
    name: 'shift-ics',
    configureServer(server) {
      server.middlewares.use('/shifts.ics', (_req, res) => {
        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.end(make());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'shifts.ics', source: make() });
    },
  };
}

export default defineConfig({
  // GitHub Pages project site: set BASE_PATH=/<repo>/ in CI.
  base: process.env.BASE_PATH ?? '/',
  plugins: [
    react(),
    shiftIcs(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: '4조 근무표',
        short_name: '4조근무',
        lang: 'ko',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg}'],
        importScripts: ['push-sw.js'],
        // Never cache Google API / auth calls.
        // Real files that must not be swallowed by the SPA fallback (base path may prefix them).
        navigateFallbackDenylist: [/shifts\.ics$/, /privacy\.html$/, /terms\.html$/],
      },
    }),
  ],
});
