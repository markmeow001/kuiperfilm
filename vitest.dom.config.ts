import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'

/**
 * DOM-flavored vitest config for React component tests.
 *
 * Lives separately from the default `vitest.config.ts` (which targets `*.test.ts` in
 * a node environment) so that:
 *   - the main `test:regression` pipeline stays unaffected
 *   - component tests opt into jsdom + @testing-library/react
 *
 * Run via: `npx vitest run --config vitest.dom.config.ts`
 *   or:    `npm run test:dom`
 */
export default defineConfig({
  plugins: [react()],
  css: {
    postcss: {
      plugins: [],
    },
  },
  resolve: {
    alias: {
      '@/scripts': resolve(__dirname, 'scripts'),
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    css: false,
    pool: 'forks',
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: 1,
      },
    },
    setupFiles: ['./tests/setup/dom-setup.ts'],
    include: [
      'tests/unit/components/**/*.test.{ts,tsx}',
      'tests/unit/query/character-finalize-mutation.test.tsx',
      'tests/unit/query/auto-group-multi-shot-mutation.test.tsx',
      'tests/integration/workspace-page.test.tsx',
    ],
    testTimeout: 10_000,
  },
})
