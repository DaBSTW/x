import { buildApp } from './app.js'
import { EnvValidationError, parseEnv } from './env.js'

function loadEnvOrExit() {
  try {
    return parseEnv(process.env)
  } catch (error) {
    if (error instanceof EnvValidationError) {
      // Configuration is validated before anything else starts — CODESTYLE.md §8.4.
      console.error(error.message)
      process.exit(1)
    }
    throw error
  }
}

const env = loadEnvOrExit()
const app = await buildApp(env)

try {
  await app.listen({ port: env.API_PORT, host: '0.0.0.0' })
} catch (error) {
  app.log.error({ err: error }, 'failed to start server')
  process.exit(1)
}
