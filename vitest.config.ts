import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const src = (p: string) => fileURLToPath(new URL(`./packages/${p}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@omni/shared': src('shared'),
      '@omni/security': src('security'),
      '@omni/providers': src('providers'),
      '@omni/core': src('core'),
    },
  },
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'apps/*/test/**/*.test.{ts,tsx}',
      'tests/**/*.test.ts',
    ],
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**'],
      thresholds: { lines: 80 },
    },
  },
});
