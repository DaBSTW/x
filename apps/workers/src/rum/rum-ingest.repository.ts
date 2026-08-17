import type { ClickHouseClient } from '@clickhouse/client'
import type { RumIngestJobData } from '@x/utils'
import { WEB_VITALS_TABLE } from './clickhouse-table.js'

export type RumIngestRepository = ReturnType<typeof createRumIngestRepository>

export function createRumIngestRepository(client: ClickHouseClient) {
  return {
    async insertMetric(job: RumIngestJobData): Promise<void> {
      await client.insert({
        table: WEB_VITALS_TABLE,
        values: [
          {
            metric: job.metric,
            value: job.value,
            rating: job.rating,
            path: job.path,
            navigation_type: job.navigationType,
            created_at: job.timestampMs,
          },
        ],
        format: 'JSONEachRow',
      })
    },
  }
}
