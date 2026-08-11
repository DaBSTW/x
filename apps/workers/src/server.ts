import { createDatabase } from '@x/db'
import { parseEnv } from './env.js'
import { createFanoutRepository } from './fanout/fanout.repository.js'
import { createFanoutWorker } from './fanout/fanout.worker.js'

const env = parseEnv(process.env)
const db = createDatabase(env.DATABASE_URL)
const repository = createFanoutRepository(db)

const fanoutWorker = createFanoutWorker({
  repository,
  redisUrl: env.REDIS_URL,
  concurrency: env.FANOUT_WORKER_CONCURRENCY,
})

fanoutWorker.worker.on('failed', (job, error) => {
  console.error(`fan-out job ${job?.id ?? '(unknown)'} failed:`, error)
})

console.info('workers: fan-out worker ready')

async function shutdown(): Promise<void> {
  await fanoutWorker.close()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
