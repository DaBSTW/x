import { createDatabase } from '@x/db'
import { COUNTER_FLUSH_INTERVAL_MS, SEARCH_INDEXER_CONSUMER_GROUP } from '@x/utils'
import { Redis } from 'ioredis'
import { createCountersFlushWorker } from './counters/counters.flush-worker.js'
import { createCountersRepository } from './counters/counters.repository.js'
import { parseEnv } from './env.js'
import { createFanoutRepository } from './fanout/fanout.repository.js'
import { createFanoutWorker } from './fanout/fanout.worker.js'
import { createMediaStorage } from './lib/media-storage.js'
import { createMediaRepository } from './media/media.repository.js'
import { createMediaWorker } from './media/media.worker.js'
import { createApnsPushSender } from './notifications/apns-sender.js'
import { createFcmPushSender } from './notifications/fcm-sender.js'
import { createNotificationsRepository } from './notifications/notifications.repository.js'
import { createNotificationsWorker } from './notifications/notifications.worker.js'
import { createWebPushSender } from './notifications/push-sender.js'
import { createOpenSearchClient, ensureSearchIndices } from './search/opensearch-client.js'
import { createSearchIndexer } from './search/search-indexer.worker.js'
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

// FCM (Android) — ROADMAP.md 2.9's last bullet. All three or none, same
// posture as VAPID above. `\n` un-escaped: a PEM private key needs real
// newlines, but most .env/process-manager configs can only carry a
// single-line string, so the conventional fix (also how Firebase's own
// docs describe deploying a service account key as an env var) is to
// escape them going in and undo it here.
const sendFcmPush =
  env.FCM_PROJECT_ID && env.FCM_CLIENT_EMAIL && env.FCM_PRIVATE_KEY
    ? createFcmPushSender({
        projectId: env.FCM_PROJECT_ID,
        clientEmail: env.FCM_CLIENT_EMAIL,
        privateKey: env.FCM_PRIVATE_KEY.replace(/\\n/g, '\n'),
      })
    : undefined
if (!sendFcmPush) {
  console.warn('FCM service account not configured — Android push notifications are disabled')
}

// APNs (iOS) — same posture, same `\n` un-escaping reasoning as FCM above.
const sendApnsPush =
  env.APNS_KEY && env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_BUNDLE_ID
    ? createApnsPushSender({
        key: env.APNS_KEY.replace(/\\n/g, '\n'),
        keyId: env.APNS_KEY_ID,
        teamId: env.APNS_TEAM_ID,
        bundleId: env.APNS_BUNDLE_ID,
        production: env.APNS_PRODUCTION,
      })
    : undefined
if (!sendApnsPush) {
  console.warn('APNs credentials not configured — iOS push notifications are disabled')
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
  ...(sendFcmPush && { sendFcmPush }),
  ...(sendApnsPush && { sendApnsPush }),
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
  clamAv: { host: env.CLAMAV_HOST, port: env.CLAMAV_PORT },
})

// Awaited before the worker below starts consuming (top-level await — this
// file is the process entrypoint, never imported, so unlike every other
// module here it's fine for it to not be synchronous) — a job arriving
// before the table exists would fail every time until the next deploy,
// instead of just the first cold start taking a few ms longer.
//
// The ensure call itself is wrapped in try/catch rather than left to throw:
// ClickHouse is documented (docker-compose.yml) as non-critical — losing it
// loses trending topics, never a post, a like, or a DM — so an unreachable
// instance at boot should degrade (trend-ingest jobs fail individually and
// get retried by BullMQ like any other job failure) rather than crash
// fan-out, notifications, and media processing along with it. Deliberately
// different from apps/api's ensurePublicBucket, which DOES process.exit(1):
// S3 is load-bearing for every media URL the API returns, so booting
// without it would just fail every request anyway — there's no degraded
// mode to fall back to there, unlike here.
const clickhouseClient = createClickHouseClient({
  url: env.CLICKHOUSE_URL,
  username: env.CLICKHOUSE_USER,
  password: env.CLICKHOUSE_PASSWORD,
  database: env.CLICKHOUSE_DATABASE,
})
try {
  await ensureHashtagMentionsTable(clickhouseClient)
} catch (error) {
  console.warn('ClickHouse unreachable at boot — trending topics will be unavailable:', error)
}
const trendIngestWorker = createTrendIngestWorker({
  repository: createTrendIngestRepository(clickhouseClient),
  redisUrl: env.REDIS_URL,
  concurrency: env.TREND_INGEST_WORKER_CONCURRENCY,
})
trendIngestWorker.worker.on('failed', (job, error) => {
  console.error(`trend-ingest job ${job?.id ?? '(unknown)'} failed:`, error)
})

// ROADMAP.md 2.3 — same top-level-await self-healing as ClickHouse above,
// and the same non-fatal posture for the same reason: ensuring the index
// mappings exist is a self-contained piece worth having ready before the
// CDC-consuming indexer worker below starts writing to them. An unreachable
// OpenSearch at boot should degrade (search unavailable) rather than take
// the whole process down with it.
const openSearchClient = createOpenSearchClient({ url: env.OPENSEARCH_URL })
try {
  await ensureSearchIndices(openSearchClient)
} catch (error) {
  console.warn('OpenSearch unreachable at boot — search will be unavailable:', error)
}

// search-indexer.worker.ts's own `.start()` connects a Kafka consumer
// (kafkajs retries a bounded number of times with backoff on its own before
// giving up — this isn't an instant fail like the two checks above, but it
// is a bounded one). Same non-fatal posture: an unreachable Redpanda/Kafka
// at boot degrades search freshness (the index stops receiving updates,
// nothing else) rather than crashing fan-out/notifications/media with it.
const searchIndexer = createSearchIndexer({
  brokers: env.KAFKA_BROKERS.split(','),
  groupId: SEARCH_INDEXER_CONSUMER_GROUP,
  db,
  openSearchClient,
})
try {
  await searchIndexer.start()
} catch (error) {
  console.warn('Kafka/Redpanda unreachable at boot — the search index will fall behind:', error)
}

console.info(
  'workers: fan-out, notifications, media, counters flush, trend-ingest, and search-indexer workers ready',
)

async function shutdown(): Promise<void> {
  countersFlushWorker.stop()
  countersRedis.disconnect()
  await Promise.all([
    fanoutWorker.close(),
    notificationsWorker.close(),
    mediaWorker.close(),
    trendIngestWorker.close(),
    searchIndexer.stop(),
  ])
  await Promise.all([clickhouseClient.close(), openSearchClient.close()])
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
