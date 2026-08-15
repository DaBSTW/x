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
  const db = createReplicatedDatabase(options.databaseUrl, options.replicaUrls)
  app.decorate('db', db)
})
