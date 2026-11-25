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
    // The scripted models of the desktop agent tests edit files without reading them first.
    // The read-before-change rule is tested on its own (agent-loop.test.ts), with this unset.
    env: { ZINARIX_AGENT_EDIT_UNREAD: 'allow' },
    coverage: {
      provider: 'v8',
      // The desktop's main process and shared code count too (E3): that is the product.
      // The renderer is covered by `pnpm e2e`, not by these tests.
      include: ['packages/*/src/**', 'apps/desktop/src/main/**', 'apps/desktop/src/shared/**'],
      // Floors that only go up: raise a number when coverage grows, never lower it.
      // Measured 2026-11-25: desktop 59 % of lines (CI skips a few tool tests, hence 55).
      thresholds: {
        'packages/*/src/**': { lines: 80 },
        'apps/desktop/src/{main,shared}/**': { lines: 55 },
      },
    },
  },
});
