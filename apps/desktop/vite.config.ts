import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { noticesPlugin } from './scripts/notices.mjs';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  // noticesPlugin: third-party notices and the license gate (scripts/notices.mjs).
  plugins: [react(), noticesPlugin()],
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    target: 'chrome140',
    chunkSizeWarningLimit: 8000,
    sourcemap: false,
  },
  worker: { format: 'es' },
});
