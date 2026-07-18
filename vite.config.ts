/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { createManifestConfig } from './src/pwa/manifest.js';

const BASE_PATH = process.env.VITE_BASE_PATH ?? '/puzzle/';

export default defineConfig({
  base: BASE_PATH,
  plugins: [
    // We use the `injectManifest` strategy (custom worker at src/pwa/sw.ts)
    // rather than `generateSW` so the worker can register its own `error` /
    // `unhandledrejection` listeners (#430). The navigation fallback and its
    // cross-deployment denylist — which `generateSW`'s `workbox` options used
    // to configure — now live in the worker source; this config only injects
    // the precache manifest.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/pwa',
      filename: 'sw.ts',
      registerType: 'prompt',
      manifest: createManifestConfig(BASE_PATH),
    }),
  ],
  test: {
    // Skip any sibling git worktrees a contributor may have checked out
    // under `.worktrees/`. Without this, vitest's default discovery walks
    // into them and runs tests from *other* branches alongside this one,
    // which drifts local test counts away from CI and can mask failures.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.worktrees/**'],
    // Allow palette.css / style.css to be imported as ?raw in their tests.
    css: { include: [/palette\.css/, /style\.css/] },
  },
});
