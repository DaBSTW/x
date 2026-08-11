import { createSnowflakeGenerator } from './snowflake.js'

function readWorkerId(): number {
  const raw = process.env.WORKER_ID
  if (raw === undefined) return 0

  const parsed = Number(raw)
  if (!Number.isInteger(parsed)) {
    throw new RangeError(`WORKER_ID must be an integer, got "${raw}"`)
  }
  return parsed
}

const defaultGenerator = createSnowflakeGenerator(readWorkerId())

/** Generates a Snowflake ID using the process-wide generator (worker id from `WORKER_ID`). */
export function generateId(): bigint {
  return defaultGenerator.nextId()
}
