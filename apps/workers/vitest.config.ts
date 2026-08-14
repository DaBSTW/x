import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
    coverage: {
      provider: 'v8',
      // Repository queries and the BullMQ wiring itself touch real
      // Postgres/Redis — exercised by test:integration, not unit tests.
      include: [
        'src/fanout/fanout.processor.ts',
        'src/counters/counters.flush-worker.ts',
        'src/media/media.processor.ts',
        'src/media/ffmpeg-runner.ts',
        'src/media/gif-transcoder.ts',
        'src/media/video-transcoder.ts',
        'src/notifications/notifications.processor.ts',
        'src/notifications/push-text.ts',
        'src/notifications/fcm-token-errors.ts',
        'src/notifications/apns-token-errors.ts',
        'src/search/cdc.ts',
        'src/search/document-builders.ts',
        'src/trends/rank-hashtags.ts',
        'src/trends/trend-ingest.processor.ts',
        'src/env.ts',
        // Factored out of register-cdc-connector.ts for the same reason
        // rank-hashtags.ts is factored out of compute-trends.ts above: the
        // script itself is a thin, uncovered entrypoint (like server.ts),
        // this is the actual testable logic.
        'scripts/lib/cdc-connector-config.ts',
      ],
      thresholds: { lines: 80, statements: 80, branches: 80, functions: 80 },
    },
  },
})
