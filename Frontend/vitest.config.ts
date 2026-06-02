import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: '@scripts', replacement: resolve(__dirname, 'src/scripts') },
      { find: '@modals', replacement: resolve(__dirname, 'src/modals') },
      { find: '@', replacement: resolve(__dirname, 'src') },
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setupTests.ts'],
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      exclude: [
        'tests/**',
        'src/modals/**',
        'src/styles/**',
        'src/scripts/**/*.test.ts',
      ],
      thresholds: {
        statements: 95,
        branches: 85,
        functions: 95,
        lines: 95,
      },
    },
  },
})
