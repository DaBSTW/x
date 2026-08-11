// 64-bit Snowflake ID layout: (timestamp_ms - EPOCH) << 22 | worker_id << 10 | sequence.
// See SPECS.md §4.1 and docs/adr/0002-migraciones.md for why IDs are Snowflakes
// instead of UUIDs or auto-increment.

const WORKER_ID_BITS = 10n
const SEQUENCE_BITS = 12n
const MAX_WORKER_ID = (1n << WORKER_ID_BITS) - 1n
const MAX_SEQUENCE = (1n << SEQUENCE_BITS) - 1n
const TIMESTAMP_SHIFT = WORKER_ID_BITS + SEQUENCE_BITS
const WORKER_ID_SHIFT = SEQUENCE_BITS

// Custom epoch (2024-01-01T00:00:00Z) instead of the Unix epoch: keeps generated
// IDs smaller and leaves the 42-bit timestamp field valid until roughly year 2163.
const EPOCH_MS = 1_704_067_200_000n

// Above this, waiting for the clock to catch up would block the request for
// longer than the drift is worth absorbing — fail loudly instead (CODESTYLE.md §8.4).
const MAX_CLOCK_BACKWARDS_WAIT_MS = 100

export class ClockDriftError extends Error {
  constructor(readonly driftMs: number) {
    super(`system clock moved backwards by ${driftMs}ms, refusing to generate a duplicate id`)
    this.name = 'ClockDriftError'
  }
}

export type SnowflakeGenerator = {
  nextId: () => bigint
}

/**
 * Creates a Snowflake ID generator bound to a single `workerId`.
 *
 * IDs are monotonically increasing within a worker, which is what makes cursor
 * pagination possible without a secondary sort key (CODESTYLE.md §6).
 *
 * @throws {RangeError} If `workerId` is outside `[0, 1023]`.
 * @throws {ClockDriftError} If the system clock moved backwards more than 100ms.
 */
export function createSnowflakeGenerator(
  workerId: number,
  now: () => number = Date.now,
): SnowflakeGenerator {
  if (!Number.isInteger(workerId) || workerId < 0 || BigInt(workerId) > MAX_WORKER_ID) {
    throw new RangeError(`workerId must be an integer between 0 and ${MAX_WORKER_ID}`)
  }

  const workerIdBig = BigInt(workerId)
  let lastTimestamp = -1n
  let sequence = 0n

  return {
    nextId(): bigint {
      let timestamp = BigInt(now())

      if (timestamp < lastTimestamp) {
        const driftMs = Number(lastTimestamp - timestamp)
        if (driftMs > MAX_CLOCK_BACKWARDS_WAIT_MS) {
          throw new ClockDriftError(driftMs)
        }
        // Small drift (e.g. an NTP step): wait for the clock to catch up
        // rather than risk emitting an id that collides with one already issued.
        while (timestamp < lastTimestamp) {
          timestamp = BigInt(now())
        }
      }

      if (timestamp === lastTimestamp) {
        sequence = (sequence + 1n) & MAX_SEQUENCE
        if (sequence === 0n) {
          // Sequence exhausted within this millisecond: spin until the clock ticks forward.
          while (timestamp <= lastTimestamp) {
            timestamp = BigInt(now())
          }
        }
      } else {
        sequence = 0n
      }

      lastTimestamp = timestamp

      return (
        ((timestamp - EPOCH_MS) << TIMESTAMP_SHIFT) | (workerIdBig << WORKER_ID_SHIFT) | sequence
      )
    },
  }
}

/** Extracts the creation timestamp (Unix epoch ms) encoded in a Snowflake ID. */
export function extractTimestamp(id: bigint): number {
  return Number((id >> TIMESTAMP_SHIFT) + EPOCH_MS)
}

/** Extracts the worker id encoded in a Snowflake ID. */
export function extractWorkerId(id: bigint): number {
  return Number((id >> WORKER_ID_SHIFT) & MAX_WORKER_ID)
}
