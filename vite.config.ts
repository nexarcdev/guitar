/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { learnEnabled, staticPaths } from './src/state/routes.ts';

/**
 * Real URLs on GitHub Pages, which has no rewrites: every route gets its own copy of the app's
 * page (`learn/lesson.html`, served for `/learn/lesson` with a 200 and no trailing-slash
 * redirect), and `404.html` boots the app for anything else so it can show its own not-found view.
 */
function routePages(): Plugin {
  let outDir = 'dist';
  return {
    name: 'fretline-route-pages',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const html = readFileSync(join(outDir, 'index.html'), 'utf8');
      for (const p of [...staticPaths(learnEnabled(process.env.VITE_LEARN_MODULES)), '404']) {
        const file = join(outDir, `${p}.html`);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, html);
      }
    },
  };
}

// GitHub Pages serves a project site from /<repo>/; CI sets BASE_PATH accordingly.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  // Shown in the app (Your guitar → About) so you can tell which build you're running.
  define: {
    __APP_VERSION__: JSON.stringify((process.env.GITHUB_SHA ?? 'dev').slice(0, 7)),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Fretline',
        short_name: 'Fretline',
        description: 'Tuner, chord identifier, tab stream and pedalboard for guitar.',
        theme_color: '#221c19',
        background_color: '#221c19',
        display: 'standalone',
        orientation: 'any',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        // The ML worker bundles tfjs (several MB) plus the model and wasm: precache it all for offline use.
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,json,bin,woff2}'],
        // Offline, every in-app URL opens the app shell; the router picks the view.
        navigateFallback: 'index.html',
      },
    }),
    routePages(),
  ],
  worker: { format: 'es' },
  build: { target: 'es2022' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
