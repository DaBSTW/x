import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      // types.gen.ts is generated output — nothing to unit-test in it.
      include: ['src/**'],
      exclude: ['src/types.gen.ts'],
      thresholds: { lines: 80, statements: 80, branches: 80, functions: 80 },
    },
  },
})
