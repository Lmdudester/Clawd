import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    alias: {
      '@clawd/shared': new URL('../shared/src/index.ts', import.meta.url).pathname,
    },
  },
});
