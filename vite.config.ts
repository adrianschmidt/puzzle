import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { createManifestConfig } from './src/pwa/manifest.js';

const BASE_PATH = process.env.VITE_BASE_PATH ?? '/puzzle/';

export default defineConfig({
  base: BASE_PATH,
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: createManifestConfig(BASE_PATH),
    }),
  ],
});
