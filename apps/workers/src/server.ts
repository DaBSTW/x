import { createDatabase } from '@x/db'
import { COUNTER_FLUSH_INTERVAL_MS } from '@x/utils'
import { Redis } from 'ioredis'
import { createCountersFlushWorker } from './counters/counters.flush-worker.js'
import { createCountersRepository } from './counters/counters.repository.js'
import { parseEnv } from './env.js'
import { createFanoutRepository } from './fanout/fanout.repository.js'
import { createFanoutWorker } from './fanout/fanout.worker.js'
import { createMediaStorage } from './lib/media-storage.js'
import { createMediaRepository } from './media/media.repository.js'
import { createMediaWorker } from './media/media.worker.js'
import { createNotificationsRepository } from './notifications/notifications.repository.js'
import { createNotificationsWorker } from './notifications/notifications.worker.js'
import { createWebPushSender } from './notifications/push-sender.js'
import { createClickHouseClient, ensureHashtagMentionsTable } from './trends/clickhouse-client.js'
import { createTrendIngestRepository } from './trends/trend-ingest.repository.js'
import { createTrendIngestWorker } from './trends/trend-ingest.worker.js'

const env = parseEnv(process.env)
const db = createDatabase(env.DATABASE_URL)

// Both keys configured or neither — a lone key can't sign anything.
const sendPush =
  env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
    ? createWebPushSender({
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
        subject: env.VAPID_SUBJECT,
      })
    : undefined
if (!sendPush) {
  console.warn('VAPID keys not configured — web push notifications are disabled')
}

const fanoutWorker = createFanoutWorker({
  repository: createFanoutRepository(db),
  redisUrl: env.REDIS_URL,
  concurrency: env.FANOUT_WORKER_CONCURRENCY,
})
fanoutWorker.worker.on('failed', (job, error) => {
  console.error(`fan-out job ${job?.id ?? '(unknown)'} failed:`, error)
})

const notificationsWorker = createNotificationsWorker({
  repository: createNotificationsRepository(db),
  redisUrl: env.REDIS_URL,
  concurrency: env.NOTIFICATIONS_WORKER_CONCURRENCY,
  ...(sendPush && { sendPush }),
})
notificationsWorker.worker.on('failed', (job, error) => {
  console.error(`notification job ${job?.id ?? '(unknown)'} failed:`, error)
})

const countersRedis = new Redis(env.REDIS_URL)
const countersFlushWorker = createCountersFlushWorker(
  createCountersRepository(db),
  countersRedis,
  COUNTER_FLUSH_INTERVAL_MS,
)
countersFlushWorker.start()

const mediaStorage = createMediaStorage({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
})
const mediaWorker = createMediaWorker({
  repository: createMediaRepository(db),
  storage: mediaStorage,
  bucket: env.S3_BUCKET,
  redisUrl: env.REDIS_URL,
  concurrency: env.MEDIA_WORKER_CONCURRENCY,
})

// Awaited before the worker below starts consuming (top-level await — this
// file is the process entrypoint, never imported, so unlike every other
// module here it's fine for it to not be synchronous) — a job arriving
// before the table exists would fail every time until the next deploy,
// instead of just the first cold start taking a few ms longer.
const clickhouseClient = createClickHouseClient({
  url: env.CLICKHOUSE_URL,
  username: env.CLICKHOUSE_USER,
  password: env.CLICKHOUSE_PASSWORD,
  database: env.CLICKHOUSE_DATABASE,
})
await ensureHashtagMentionsTable(clickhouseClient)
const trendIngestWorker = createTrendIngestWorker({
  repository: createTrendIngestRepository(clickhouseClient),
  redisUrl: env.REDIS_URL,
  concurrency: env.TREND_INGEST_WORKER_CONCURRENCY,
})
trendIngestWorker.worker.on('failed', (job, error) => {
  console.error(`trend-ingest job ${job?.id ?? '(unknown)'} failed:`, error)
})

console.info(
  'workers: fan-out, notifications, media, counters flush, and trend-ingest workers ready',
)

async function shutdown(): Promise<void> {
  countersFlushWorker.stop()
  countersRedis.disconnect()
  await Promise.all([
    fanoutWorker.close(),
    notificationsWorker.close(),
    mediaWorker.close(),
    trendIngestWorker.close(),
  ])
  await clickhouseClient.close()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
