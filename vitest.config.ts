import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
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
    environment: 'node',
    css: false,
    // next-intl's ESM middleware imports the Next.js `next/server`
    // subpath. Inline it so behavior tests execute the real middleware
    // through Vite's resolver instead of Node externalizing the package.
    server: {
      deps: {
        inline: [/next-intl/],
      },
    },
    pool: 'forks',
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: 1,
      },
    },
    setupFiles: ['./tests/setup/env.ts'],
    globalSetup: ['./tests/setup/global-setup.ts'],
    include: ['**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage/billing',
      include: [
        'src/lib/billing/cost.ts',
        'src/lib/billing/mode.ts',
        'src/lib/billing/task-policy.ts',
        'src/lib/billing/runtime-usage.ts',
        'src/lib/billing/service.ts',
        'src/lib/billing/ledger.ts',
      ],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
})
