import {
  type ReportRumMetricRequest,
  errorResponseSchema,
  reportRumMetricRequestSchema,
} from '@x/contracts'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import type { Redis } from 'ioredis'
import { z } from 'zod'
import { enforceRateLimit } from '../../lib/rate-limit.js'
import type { RumIngestQueue } from '../../lib/rum-ingest-queue.js'

const RATE_LIMIT_WINDOW_MS = 60 * 1000
// Generous on purpose: one real page view can fire up to six of these
// (CLS/FCP/FID/INP/LCP/TTFB), and a genuinely active session navigates
// several pages a minute — this only exists to block a flood, not to
// throttle a real, if unusually active, visitor.
const RATE_LIMIT_MAX = 120

export type RumRoutesOptions = {
  rumIngestQueue: RumIngestQueue
  redis: Redis
}

/**
 * ROADMAP.md 3.4g / SPECS.md §14's Core Web Vitals RUM. Deliberately
 * public, like GET /trends: a page can (and for the landing page 3.4f's
 * own bundle budget targets, routinely does) render before the visitor
 * ever logs in, so this can't require the same auth every other write
 * route in this file's siblings does. apps/web's reporter sends this via
 * `navigator.sendBeacon`, which never reads the response — the 204/429
 * split here is for server-side hygiene (real signal in access logs,
 * consistent with how every other rate-limited route in this codebase
 * behaves), not because any caller acts on it.
 */
export async function registerRumRoutes(app: FastifyInstance, options: RumRoutesOptions) {
  const { rumIngestQueue, redis } = options
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.post(
    '/rum',
    {
      schema: {
        body: reportRumMetricRequestSchema,
        response: { 204: z.null(), 429: errorResponseSchema },
      },
    },
    async (request, reply) => {
      await enforceRateLimit(redis, `rum:ip:${request.ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)

      const body: ReportRumMetricRequest = request.body
      await rumIngestQueue.enqueue({
        metric: body.metric,
        value: body.value,
        rating: body.rating,
        path: body.path,
        navigationType: body.navigationType,
        timestampMs: Date.now(),
      })

      return reply.status(204).send(null)
    },
  )
}
