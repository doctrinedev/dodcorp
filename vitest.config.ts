import { defineConfig } from 'vitest/config';

// Shared test config for the whole workspace. Tests live next to the code
// they cover (`src/foo.ts` -> `src/foo.test.ts`).
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/*/src/**/*.test.ts', 'packages/*/src/index.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});
