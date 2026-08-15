import { type ChildProcess, spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MinioContainer } from '@testcontainers/minio'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer } from '@testcontainers/redis'
import { createDatabase, migrationsFolderUrl } from '@x/db'
import { createS3Client, ensurePublicBucket } from '@x/utils'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const API_DIR = path.join(REPO_ROOT, 'apps/api')
const ADMIN_DIR = path.join(REPO_ROOT, 'apps/admin')

const S3_BUCKET = 'x-media'
const API_PORT = 3001
const ADMIN_PORT = 3003

async function waitForUrl(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`timed out waiting for ${url} to respond: ${String(lastError)}`)
}

function spawnService(
  label: string,
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): ChildProcess {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', (chunk: Buffer) => process.stdout.write(`[${label}] ${chunk}`))
  child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[${label}] ${chunk}`))
  return child
}

/** SIGTERMs the whole process group, not just the immediate child (`next dev`/`tsx` both spawn their own children) — same as apps/web's own e2e/global-setup.ts. */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    // Already exited — nothing to do.
  }
}

/**
 * e2e against a real stack — leaner than apps/web's own global-setup.ts:
 * moderation lives entirely in apps/api (ROADMAP.md 3.3), so this only
 * needs apps/api itself, not apps/workers or ws-gateway. MinIO is still
 * required (not skippable, unlike Kafka/Mailpit) — apps/api's own
 * server.ts calls ensurePublicBucket before it will even start listening
 * and process.exit(1)s if that fails, the same "load-bearing, not
 * degradable" reasoning its own comment gives for why apps/web's e2e setup
 * needs it too.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const [postgres, redis, minio] = await Promise.all([
    new PostgreSqlContainer('postgres:17-alpine').start(),
    new RedisContainer('redis:7-alpine').start(),
    new MinioContainer('minio/minio:latest').start(),
  ])

  const migrationDb = createDatabase(postgres.getConnectionUri())
  await migrate(migrationDb, { migrationsFolder: fileURLToPath(migrationsFolderUrl()) })

  // Read by e2e/helpers.ts's makeModerator — this app's login has no
  // sign-up-as-moderator path (packages/db/src/schema/users.ts's own
  // comment on isModerator: SQL only), so the suite needs its own
  // connection to flip that flag directly, the same "process.env is the
  // only channel a Playwright globalSetup has to a spec file" pattern
  // apps/web's own global-setup.ts already uses for a different table.
  process.env.DATABASE_URL = postgres.getConnectionUri()

  const s3Client = createS3Client({
    endpoint: minio.getConnectionUrl(),
    region: 'us-east-1',
    accessKeyId: minio.getUsername(),
    secretAccessKey: minio.getPassword(),
    forcePathStyle: true,
  })
  await ensurePublicBucket(s3Client, S3_BUCKET)

  const sharedEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'development',
    DATABASE_URL: postgres.getConnectionUri(),
    REDIS_URL: redis.getConnectionUrl(),
    S3_ENDPOINT: minio.getConnectionUrl(),
    S3_REGION: 'us-east-1',
    S3_BUCKET,
    S3_ACCESS_KEY_ID: minio.getUsername(),
    S3_SECRET_ACCESS_KEY: minio.getPassword(),
    S3_FORCE_PATH_STYLE: 'true',
    // Every spec in this suite logs in against this one shared backend/IP
    // (workers: 1 in playwright.config.ts) — same reasoning as apps/web's
    // own global-setup.ts raising this past the production-sane default.
    LOGIN_RATE_LIMIT_MAX: '1000',
  }

  const apiProcess = spawnService(
    'api',
    path.join(API_DIR, 'node_modules/.bin/tsx'),
    ['src/server.ts'],
    {
      cwd: API_DIR,
      env: {
        ...sharedEnv,
        API_PORT: String(API_PORT),
        WORKER_ID: '1',
        // env.ts's own CORS_ORIGIN default is port 3000 (apps/web) — this
        // app runs on ADMIN_PORT instead, so without this override every
        // browser-side request the login page makes is silently blocked by
        // CORS before it ever reaches apps/api (found by actually running
        // this suite: the backend logs showed the OPTIONS preflight but
        // never the POST /auth/login that should have followed it).
        CORS_ORIGIN: `http://localhost:${ADMIN_PORT}`,
      },
    },
  )
  await waitForUrl(`http://localhost:${API_PORT}/health`, 30_000)

  const adminProcess = spawnService(
    'admin',
    path.join(ADMIN_DIR, 'node_modules/.bin/next'),
    ['dev', '-p', String(ADMIN_PORT)],
    {
      cwd: ADMIN_DIR,
      env: { ...sharedEnv, NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}/v1` },
    },
  )
  await waitForUrl(`http://localhost:${ADMIN_PORT}`, 60_000)

  return async () => {
    for (const child of [adminProcess, apiProcess]) killTree(child)
    await Promise.all([postgres.stop(), redis.stop(), minio.stop()])
  }
}
