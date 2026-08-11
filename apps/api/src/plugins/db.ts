import { type Database, createDatabase } from '@x/db'
import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'

declare module 'fastify' {
  interface FastifyInstance {
    db: Database
  }
}

export type DbPluginOptions = {
  databaseUrl: string
}

export default fp(async function dbPlugin(app: FastifyInstance, options: DbPluginOptions) {
  const db = createDatabase(options.databaseUrl)
  app.decorate('db', db)
})
