import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    exclude: ['**/node_modules/**', '**/.next/**', '**/e2e/**'],
    coverage: {
      provider: 'v8',
      // Data-fetching hooks (use-session, use-auth-mutations, use-timeline, …)
      // and components that mostly wire those hooks together (Composer,
      // PostCard, Timeline) are exercised by Playwright e2e once it exists
      // (ROADMAP.md 1.8's deferred e2e bullet), not here. Pure logic — no
      // network, no hooks — is unit-tested and counted like any other file.
      include: [
        'lib/cn.ts',
        'lib/auth-store.ts',
        'lib/theme-store.ts',
        'lib/format.ts',
        'lib/media-grid-layout.ts',
        'lib/notification-text.ts',
        'lib/notification-grouping.ts',
        'lib/realtime-backoff.ts',
        'lib/shortcuts-dialog-store.ts',
        // A hook, unlike the data-fetching ones this file's own comment
        // excludes above — but no network/React Query involved, just a
        // mockable browser API (matchMedia), so unlike use-session/
        // use-timeline it's meaningfully unit-testable without a real
        // backend at all.
        'lib/use-reduced-motion.ts',
        'components/ui/button.tsx',
        'components/rich-text.tsx',
      ],
      thresholds: { lines: 80, statements: 80, branches: 80, functions: 80 },
    },
  },
})
