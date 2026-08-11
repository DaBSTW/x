import { createDatabase } from '@x/db'
import { COUNTER_FLUSH_INTERVAL_MS } from '@x/utils'
import { Redis } from 'ioredis'
import { createCountersFlushWorker } from './counters/counters.flush-worker.js'
import { createCountersRepository } from './counters/counters.repository.js'
import { parseEnv } from './env.js'
import { createFanoutRepository } from './fanout/fanout.repository.js'
import { createFanoutWorker } from './fanout/fanout.worker.js'
import { createNotificationsRepository } from './notifications/notifications.repository.js'
import { createNotificationsWorker } from './notifications/notifications.worker.js'

const env = parseEnv(process.env)
const db = createDatabase(env.DATABASE_URL)

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

console.info('workers: fan-out, notifications, and counters flush workers ready')

async function shutdown(): Promise<void> {
  countersFlushWorker.stop()
  countersRedis.disconnect()
  await Promise.all([fanoutWorker.close(), notificationsWorker.close()])
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
