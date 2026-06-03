/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { createManifestConfig } from './src/pwa/manifest.js';

const BASE_PATH = process.env.VITE_BASE_PATH ?? '/puzzle/';

// Prevent this SW from intercepting navigations to paths that belong to
// other deployments under the same origin (e.g. /puzzle/dev/ when we're
// the production build at /puzzle/). Without this, the production SW's
// navigation fallback would serve the production index.html for requests
// to /puzzle/dev/, blocking the dev preview from ever bootstrapping.
const escapedBase = BASE_PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const navigateFallbackDenylist = [
  // Deny any path that starts with a subdirectory immediately below our base
  // (e.g. /puzzle/dev/, /puzzle/pr-123/, etc.)
  new RegExp(`^${escapedBase}[^/]+/`),
];

export default defineConfig({
  base: BASE_PATH,
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: createManifestConfig(BASE_PATH),
      workbox: {
        navigateFallbackDenylist,
      },
    }),
  ],
  test: {
    // Skip any sibling git worktrees a contributor may have checked out
    // under `.worktrees/`. Without this, vitest's default discovery walks
    // into them and runs tests from *other* branches alongside this one,
    // which drifts local test counts away from CI and can mask failures.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.worktrees/**'],
    // Allow palette.css to be imported as ?raw in palette.test.ts.
    css: { include: [/palette\.css/] },
  },
});
