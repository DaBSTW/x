import { createS3Client, ensurePublicBucket } from '@x/utils'
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

// Here, not in app.ts's buildApp: scripts/generate-openapi.ts also calls
// buildApp, purely to read the swagger document off the built instance,
// deliberately without needing a real Postgres/Redis/S3 endpoint (they all
// connect lazily — this one wouldn't). Idempotent (packages/utils/src/s3.ts)
// and the same fix apps/web/e2e/global-setup.ts applies for e2e — without
// it, every media URL apps/web renders 403s the moment a browser actually
// fetches it (ROADMAP.md 1.5/1.6).
try {
  await ensurePublicBucket(
    createS3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    }),
    env.S3_BUCKET,
  )
} catch (error) {
  console.error('failed to ensure the media bucket exists with a public-read policy:', error)
  process.exit(1)
}

const app = await buildApp(env)

try {
  await app.listen({ port: env.API_PORT, host: '0.0.0.0' })
} catch (error) {
  app.log.error({ err: error }, 'failed to start server')
  process.exit(1)
}
