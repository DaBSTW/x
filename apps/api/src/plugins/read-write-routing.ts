import { didWriteDuringRequest, enterReadWriteContext } from '@x/db'
import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'

const READ_YOUR_WRITES_COOKIE_NAME = 'read_your_writes'
// SPECS.md §14.2's own number, verbatim: "durante 5 s tras una escritura".
const READ_YOUR_WRITES_WINDOW_SECONDS = 5

export type ReadWriteRoutingPluginOptions = {
  nodeEnv: string
}

/**
 * SPECS.md §14.2 — the per-request half of ROADMAP.md 3.4d's read-replica
 * routing; packages/db's createReplicatedDatabase (wired into `app.db` by
 * plugins/db.ts) is the other half, and does the actual primary/replica
 * picking by consulting read-write-context.ts's ambient per-request state
 * this plugin establishes. Registered after `cookie` (needs
 * `request.cookies`, which that plugin's own onRequest hook populates —
 * same-type Fastify hooks run in registration order, so app.ts's ordering
 * is what makes this safe) and before `db` doesn't actually matter (the
 * routing itself only reads ambient async context when a query runs, never
 * at plugin-registration time), but is kept that way for readability.
 *
 * onRequest calls enterReadWriteContext with whether the *incoming* request
 * already carries the cookie (a write within the last 5 s, from an earlier
 * request) — every select app.db makes for the rest of this request's
 * lifecycle prefers the primary if so. Uses enterWith (inside
 * enterReadWriteContext), not run: this needs to persist across Fastify's
 * own separate onRequest → preHandler → handler → onSend lifecycle stages,
 * not just the synchronous extent of one hook function's own body —
 * read-write-context.ts's own comment has the full reasoning.
 *
 * onSend then checks didWriteDuringRequest(): only a *new* write during
 * this exact request (re)sets the cookie — a request that started with the
 * cookie already present but performed no write of its own lets it run out
 * naturally, matching "durante 5 s tras una escritura" literally (5 s after
 * the last write, not 5 s after the last read).
 */
export default fp(async function readWriteRoutingPlugin(
  app: FastifyInstance,
  options: ReadWriteRoutingPluginOptions,
) {
  app.addHook('onRequest', async (request) => {
    enterReadWriteContext(request.cookies[READ_YOUR_WRITES_COOKIE_NAME] !== undefined)
  })

  app.addHook('onSend', async (_request, reply, payload) => {
    if (didWriteDuringRequest()) {
      reply.setCookie(READ_YOUR_WRITES_COOKIE_NAME, '1', {
        httpOnly: true,
        secure: options.nodeEnv === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: READ_YOUR_WRITES_WINDOW_SECONDS,
      })
    }
    return payload
  })
})
