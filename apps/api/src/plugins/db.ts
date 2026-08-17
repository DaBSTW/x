import { type Database, createReplicatedDatabase } from '@x/db'
import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'

declare module 'fastify' {
  interface FastifyInstance {
    db: Database
  }
}

export type DbPluginOptions = {
  databaseUrl: string
  /** SPECS.md §14.2 — empty (the default) falls back to databaseUrl only, see createReplicatedDatabase's own comment. */
  replicaUrls: string[]
}

export default fp(async function dbPlugin(app: FastifyInstance, options: DbPluginOptions) {
  // SPECS.md §14.4's "BD 2 s" applies automatically here — it's a role-level
  // Postgres default (migrations/0018_*.sql), not something this call
  // configures. See packages/db/src/client.ts's own comment for why.
  const db = createReplicatedDatabase(options.databaseUrl, options.replicaUrls)
  app.decorate('db', db)
})
