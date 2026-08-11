import { type ChildProcess, spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CreateBucketCommand } from '@aws-sdk/client-s3'
import { MinioContainer } from '@testcontainers/minio'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer } from '@testcontainers/redis'
import { createDatabase, migrationsFolderUrl } from '@x/db'
import { createS3Client } from '@x/utils'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { GenericContainer, Wait } from 'testcontainers'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const API_DIR = path.join(REPO_ROOT, 'apps/api')
const WORKERS_DIR = path.join(REPO_ROOT, 'apps/workers')
const WEB_DIR = path.join(REPO_ROOT, 'apps/web')

const S3_BUCKET = 'x-media'
const API_PORT = 3001
const WEB_PORT = 3000

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

/** SIGTERMs the whole process group, not just the immediate child (`next dev`/`tsx` both spawn their own children) — a plain child.kill() would leave those orphaned, holding the port for the next run. */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    // Already exited — nothing to do.
  }
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const [postgres, redis, mailpit, minio] = await Promise.all([
    new PostgreSqlContainer('postgres:17-alpine').start(),
    new RedisContainer('redis:7-alpine').start(),
    new GenericContainer('axllent/mailpit:latest')
      .withExposedPorts(1025, 8025)
      .withWaitStrategy(Wait.forListeningPorts())
      .start(),
    new MinioContainer('minio/minio:latest').start(),
  ])

  const migrationDb = createDatabase(postgres.getConnectionUri())
  await migrate(migrationDb, { migrationsFolder: fileURLToPath(migrationsFolderUrl()) })

  // Read by e2e/helpers.ts's waitForEmailToken — worker processes inherit
  // process.env as it stands once globalSetup returns.
  process.env.MAILPIT_API_URL = `http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}`

  const s3Client = createS3Client({
    endpoint: minio.getConnectionUrl(),
    region: 'us-east-1',
    accessKeyId: minio.getUsername(),
    secretAccessKey: minio.getPassword(),
    forcePathStyle: true,
  })
  await s3Client.send(new CreateBucketCommand({ Bucket: S3_BUCKET }))

  const sharedEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'development',
    DATABASE_URL: postgres.getConnectionUri(),
    REDIS_URL: redis.getConnectionUrl(),
    SMTP_HOST: mailpit.getHost(),
    SMTP_PORT: String(mailpit.getMappedPort(1025)),
    MAIL_FROM: 'no-reply@x.example.com',
    S3_ENDPOINT: minio.getConnectionUrl(),
    S3_REGION: 'us-east-1',
    S3_BUCKET,
    S3_ACCESS_KEY_ID: minio.getUsername(),
    S3_SECRET_ACCESS_KEY: minio.getPassword(),
    S3_FORCE_PATH_STYLE: 'true',
    // Every spec file logs in against this one shared backend/IP
    // (`workers: 1` above) — SPECS.md §11.3's production ceiling (10/15min)
    // is sized for one real client, not an entire e2e suite's worth of
    // sequential specs, so raise it well past anything the suite can rack up.
    LOGIN_RATE_LIMIT_MAX: '1000',
    FORGOT_PASSWORD_RATE_LIMIT_MAX: '1000',
  }

  const apiProcess = spawnService(
    'api',
    path.join(API_DIR, 'node_modules/.bin/tsx'),
    ['src/server.ts'],
    { cwd: API_DIR, env: { ...sharedEnv, API_PORT: String(API_PORT), WORKER_ID: '1' } },
  )
  await waitForUrl(`http://localhost:${API_PORT}/health`, 30_000)

  // No HTTP health check for workers (BullMQ, not a server) — its Redis
  // connections settle well within this window.
  const workersProcess = spawnService(
    'workers',
    path.join(WORKERS_DIR, 'node_modules/.bin/tsx'),
    ['src/server.ts'],
    { cwd: WORKERS_DIR, env: { ...sharedEnv, WORKER_ID: '2' } },
  )
  await new Promise((resolve) => setTimeout(resolve, 2_000))

  const webProcess = spawnService(
    'web',
    path.join(WEB_DIR, 'node_modules/.bin/next'),
    ['dev', '-p', String(WEB_PORT)],
    { cwd: WEB_DIR, env: sharedEnv },
  )
  await waitForUrl(`http://localhost:${WEB_PORT}`, 60_000)

  return async () => {
    for (const child of [webProcess, workersProcess, apiProcess]) killTree(child)
    await Promise.all([postgres.stop(), redis.stop(), mailpit.stop(), minio.stop()])
  }
}
