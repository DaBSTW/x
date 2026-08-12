import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import swagger from '@fastify/swagger'
import scalarApiReference from '@scalar/fastify-api-reference'
import { REALTIME_TICKET_TTL_SECONDS } from '@x/utils'
import Fastify, { type FastifyInstance } from 'fastify'
import {
  type ZodTypeProvider,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod'
import type { Env } from './env.js'
import { createFanoutQueue } from './lib/fanout-queue.js'
import { createMailer } from './lib/mailer.js'
import { createMediaQueue } from './lib/media-queue.js'
import { createMediaStorage } from './lib/media-storage.js'
import { createNotificationsQueue } from './lib/notifications-queue.js'
import { createAuthRepository } from './modules/auth/auth.repository.js'
import { registerAuthRoutes } from './modules/auth/auth.routes.js'
import { createAuthService } from './modules/auth/auth.service.js'
import { createConversationsRepository } from './modules/conversations/conversations.repository.js'
import { registerConversationsRoutes } from './modules/conversations/conversations.routes.js'
import { createConversationsService } from './modules/conversations/conversations.service.js'
import { createInteractionsRepository } from './modules/interactions/interactions.repository.js'
import { registerInteractionsRoutes } from './modules/interactions/interactions.routes.js'
import { createInteractionsService } from './modules/interactions/interactions.service.js'
import { createListsRepository } from './modules/lists/lists.repository.js'
import { registerListsRoutes } from './modules/lists/lists.routes.js'
import { createListsService } from './modules/lists/lists.service.js'
import { createMediaRepository } from './modules/media/media.repository.js'
import { registerMediaRoutes } from './modules/media/media.routes.js'
import { createMediaService } from './modules/media/media.service.js'
import { createNotificationsRepository } from './modules/notifications/notifications.repository.js'
import { registerNotificationsRoutes } from './modules/notifications/notifications.routes.js'
import { createNotificationsService } from './modules/notifications/notifications.service.js'
import { createPostsRepository } from './modules/posts/posts.repository.js'
import { registerPostsRoutes } from './modules/posts/posts.routes.js'
import { createPostsService } from './modules/posts/posts.service.js'
import { createProfilesRepository } from './modules/profiles/profiles.repository.js'
import { registerProfilesRoutes } from './modules/profiles/profiles.routes.js'
import { createProfilesService } from './modules/profiles/profiles.service.js'
import { createPushRepository } from './modules/push/push.repository.js'
import { registerPushRoutes } from './modules/push/push.routes.js'
import { createPushService } from './modules/push/push.service.js'
import { registerRealtimeRoutes } from './modules/realtime/realtime.routes.js'
import { createRealtimeService } from './modules/realtime/realtime.service.js'
import { createSocialGraphRepository } from './modules/social-graph/social-graph.repository.js'
import { registerSocialGraphRoutes } from './modules/social-graph/social-graph.routes.js'
import { createSocialGraphService } from './modules/social-graph/social-graph.service.js'
import { createTimelineRepository } from './modules/timeline/timeline.repository.js'
import { registerTimelineRoutes } from './modules/timeline/timeline.routes.js'
import { createTimelineService } from './modules/timeline/timeline.service.js'
import dbPlugin from './plugins/db.js'
import errorHandlerPlugin from './plugins/error-handler.js'
import redisPlugin from './plugins/redis.js'
import { createTokenService } from './plugins/tokens.js'

export async function buildApp(env: Env): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: env.NODE_ENV === 'test' ? 'silent' : 'info' },
    genReqId: () => crypto.randomUUID(),
  }).withTypeProvider<ZodTypeProvider>()

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  await app.register(errorHandlerPlugin)
  await app.register(helmet)
  await app.register(cors, { origin: env.CORS_ORIGIN, credentials: true })
  await app.register(cookie)
  await app.register(dbPlugin, { databaseUrl: env.DATABASE_URL })
  await app.register(redisPlugin, { redisUrl: env.REDIS_URL })

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: { title: 'X API', version: '1.0.0' },
      servers: [{ url: '/v1' }],
    },
    transform: jsonSchemaTransform,
  })
  await app.register(scalarApiReference, { routePrefix: '/docs' })

  const tokenService = await createTokenService({
    privateKeyPem: env.JWT_ACCESS_PRIVATE_KEY,
    publicKeyPem: env.JWT_ACCESS_PUBLIC_KEY,
    accessTtlMinutes: env.JWT_ACCESS_TTL_MINUTES,
  })

  const mailer = createMailer({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    from: env.MAIL_FROM,
    webUrl: env.WEB_URL,
    logger: app.log,
    // exactOptionalPropertyTypes: omit the key entirely when unset, same
    // conditional-spread as every other optional-provider config in this file.
    ...(env.RESEND_API_KEY !== undefined && { resendApiKey: env.RESEND_API_KEY }),
  })

  const authRepository = createAuthRepository(app.db)
  const authService = createAuthService({
    repository: authRepository,
    tokenService,
    mailer,
    logger: app.log,
    redis: app.redis,
    accessTtlMinutes: env.JWT_ACCESS_TTL_MINUTES,
    refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
  })

  const fanoutQueue = createFanoutQueue(env.REDIS_URL)
  const notificationsQueue = createNotificationsQueue(env.REDIS_URL)
  const mediaQueue = createMediaQueue(env.REDIS_URL)
  app.addHook('onClose', async () => {
    await Promise.all([fanoutQueue.close(), notificationsQueue.close(), mediaQueue.close()])
  })
  const publishNotification = notificationsQueue.enqueue

  // Shared by posts (embedding media in a post) and media (the standalone
  // /media/:id resource) so both agree on how a storage key becomes a URL.
  const mediaUrlConfig = { bucket: env.S3_BUCKET, publicUrlBase: env.S3_ENDPOINT }

  // Created ahead of postsService below so create() can enforce a reply_policy
  // of 'following' — only postsRepository (unlike the full social-graph
  // service) is needed for that single "does X follow Y" question.
  const socialGraphRepository = createSocialGraphRepository(app.db)

  const postsRepository = createPostsRepository(app.db)
  const postsService = createPostsService(
    postsRepository,
    async (postId, authorId) => {
      await fanoutQueue.enqueue({ postId: postId.toString(), authorId: authorId.toString() })
    },
    publishNotification,
    mediaUrlConfig,
    app.redis,
    {
      isFollowing: (followerId, followeeId) =>
        socialGraphRepository.findFollow(followerId, followeeId).then(Boolean),
    },
    // Structurally identical to BlockLookup and ProtectionLookup already —
    // no adapter needed for either, unlike isFollowing above.
    socialGraphRepository,
    socialGraphRepository,
  )

  const mediaStorage = createMediaStorage({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  })
  const mediaRepository = createMediaRepository(app.db)
  const mediaService = createMediaService(
    mediaRepository,
    mediaStorage,
    mediaQueue.enqueue,
    mediaUrlConfig,
  )

  const socialGraphService = createSocialGraphService(
    socialGraphRepository,
    app.redis,
    publishNotification,
  )

  const interactionsRepository = createInteractionsRepository(app.db)
  const interactionsService = createInteractionsService(
    interactionsRepository,
    postsRepository,
    postsService,
    app.redis,
    publishNotification,
  )

  const timelineRepository = createTimelineRepository(app.db, app.redis)
  const timelineService = createTimelineService(
    timelineRepository,
    postsService,
    {
      findLikedPostIds: interactionsRepository.findLikedPostIds,
      findBookmarkedPostIds: interactionsRepository.findBookmarkedPostIds,
      findRepostedPostIds: postsRepository.findRepostedPostIds,
    },
    // Structurally identical to MuteLookup already, same as blockLookup above.
    socialGraphRepository,
    // Ditto for BookmarksLookup.
    interactionsRepository,
  )

  const listsRepository = createListsRepository(app.db)
  const listsService = createListsService(listsRepository, postsService, socialGraphRepository)

  const conversationsRepository = createConversationsRepository(app.db)
  const conversationsService = createConversationsService(
    conversationsRepository,
    app.redis,
    {
      isFollowing: (followerId, followeeId) =>
        socialGraphRepository.findFollow(followerId, followeeId).then(Boolean),
    },
    socialGraphRepository,
  )

  const profilesRepository = createProfilesRepository(app.db)
  const profilesService = createProfilesService(profilesRepository, mediaUrlConfig)

  const notificationsRepository = createNotificationsRepository(app.db)
  const notificationsService = createNotificationsService(notificationsRepository, app.redis)

  const pushRepository = createPushRepository(app.db)
  const pushService = createPushService({
    repository: pushRepository,
    vapidPublicKey: env.VAPID_PUBLIC_KEY ?? null,
  })

  const realtimeService = createRealtimeService(app.redis, REALTIME_TICKET_TTL_SECONDS)

  app.get('/health', async () => ({ status: 'ok' }))

  await app.register(
    async (instance) => {
      await registerAuthRoutes(instance, {
        authService,
        tokenService,
        refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
        nodeEnv: env.NODE_ENV,
        loginRateLimitMax: env.LOGIN_RATE_LIMIT_MAX ?? 10,
        forgotPasswordRateLimitMax: env.FORGOT_PASSWORD_RATE_LIMIT_MAX ?? 5,
      })
    },
    { prefix: '/v1/auth' },
  )

  await app.register(
    async (instance) => {
      await registerPostsRoutes(instance, { postsService, tokenService })
    },
    { prefix: '/v1' },
  )

  await app.register(
    async (instance) => {
      await registerSocialGraphRoutes(instance, { socialGraphService, tokenService })
    },
    { prefix: '/v1' },
  )

  await app.register(
    async (instance) => {
      await registerTimelineRoutes(instance, { timelineService, tokenService })
    },
    { prefix: '/v1' },
  )

  await app.register(
    async (instance) => {
      await registerInteractionsRoutes(instance, { interactionsService, tokenService })
    },
    { prefix: '/v1' },
  )

  await app.register(
    async (instance) => {
      await registerProfilesRoutes(instance, { profilesService, tokenService })
    },
    { prefix: '/v1' },
  )

  await app.register(
    async (instance) => {
      await registerNotificationsRoutes(instance, { notificationsService, tokenService })
    },
    { prefix: '/v1' },
  )

  await app.register(
    async (instance) => {
      await registerMediaRoutes(instance, { mediaService, tokenService })
    },
    { prefix: '/v1' },
  )

  await app.register(
    async (instance) => {
      await registerListsRoutes(instance, { listsService, tokenService })
    },
    { prefix: '/v1' },
  )

  await app.register(
    async (instance) => {
      await registerConversationsRoutes(instance, { conversationsService, tokenService })
    },
    { prefix: '/v1' },
  )

  await app.register(
    async (instance) => {
      await registerPushRoutes(instance, { pushService, tokenService })
    },
    { prefix: '/v1' },
  )

  await app.register(
    async (instance) => {
      await registerRealtimeRoutes(instance, { realtimeService, tokenService })
    },
    { prefix: '/v1' },
  )

  return app
}
