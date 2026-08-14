import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import swagger from '@fastify/swagger'
import { Client as OpenSearchClient } from '@opensearch-project/opensearch'
import scalarApiReference from '@scalar/fastify-api-reference'
import {
  INTERACTION_EVENTS_TOPIC,
  type NotificationJobData,
  POST_CREATED_TOPIC,
  REALTIME_TICKET_TTL_SECONDS,
  generateId,
} from '@x/utils'
import Fastify, { type FastifyInstance } from 'fastify'
import {
  type ZodTypeProvider,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod'
import type { Env } from './env.js'
import { createKafkaEventTopic } from './lib/kafka-event-topic.js'
import { createMailer } from './lib/mailer.js'
import { createMediaQueue } from './lib/media-queue.js'
import { createMediaStorage } from './lib/media-storage.js'
import { createTrendIngestQueue } from './lib/trend-ingest-queue.js'
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
import { createModerationRepository } from './modules/moderation/moderation.repository.js'
import { registerModerationRoutes } from './modules/moderation/moderation.routes.js'
import { createModerationService } from './modules/moderation/moderation.service.js'
import { createNotificationsRepository } from './modules/notifications/notifications.repository.js'
import { registerNotificationsRoutes } from './modules/notifications/notifications.routes.js'
import { createNotificationsService } from './modules/notifications/notifications.service.js'
import { createPostsRepository } from './modules/posts/posts.repository.js'
import { registerPostsRoutes } from './modules/posts/posts.routes.js'
import {
  checkMaliciousUrlsAgainstTestDomains,
  createPostsService,
} from './modules/posts/posts.service.js'
import { createProfilesRepository } from './modules/profiles/profiles.repository.js'
import { registerProfilesRoutes } from './modules/profiles/profiles.routes.js'
import { createProfilesService } from './modules/profiles/profiles.service.js'
import { createPushRepository } from './modules/push/push.repository.js'
import { registerPushRoutes } from './modules/push/push.routes.js'
import { createPushService } from './modules/push/push.service.js'
import { registerRealtimeRoutes } from './modules/realtime/realtime.routes.js'
import { createRealtimeService } from './modules/realtime/realtime.service.js'
import { createSearchRepository } from './modules/search/search.repository.js'
import { registerSearchRoutes } from './modules/search/search.routes.js'
import { createSearchService } from './modules/search/search.service.js'
import { createSocialGraphRepository } from './modules/social-graph/social-graph.repository.js'
import { registerSocialGraphRoutes } from './modules/social-graph/social-graph.routes.js'
import { createSocialGraphService } from './modules/social-graph/social-graph.service.js'
import { createTimelineRepository } from './modules/timeline/timeline.repository.js'
import { registerTimelineRoutes } from './modules/timeline/timeline.routes.js'
import { createTimelineService } from './modules/timeline/timeline.service.js'
import { createTrendsRepository } from './modules/trends/trends.repository.js'
import { registerTrendsRoutes } from './modules/trends/trends.routes.js'
import { createTrendsService } from './modules/trends/trends.service.js'
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

  // ROADMAP.md 3.1 — Kafka replaces BullMQ for these two specifically
  // (SPECS.md §3.2's own architecture diagram and §13.1 both name them as
  // Kafka's own flows); media/trend-ingest below stay on BullMQ, the
  // "mantener BullMQ para jobs de baja frecuencia" half of the same bullet.
  const fanoutTopic = createKafkaEventTopic<{ postId: string; authorId: string }>({
    brokers: env.KAFKA_BROKERS,
    clientId: 'x-api',
    topic: POST_CREATED_TOPIC,
    // authorId, not postId: fan-out's own consumer (apps/workers) reads
    // "who posted" to look up followers, and partitioning by the same key
    // a reader groups by is what actually preserves per-author ordering
    // (SPECS.md 3.1's "particionado por user_id").
    partitionKey: (data) => data.authorId,
  })
  const notificationsTopic = createKafkaEventTopic<NotificationJobData & { eventId: string }>({
    brokers: env.KAFKA_BROKERS,
    clientId: 'x-api',
    topic: INTERACTION_EVENTS_TOPIC,
    // The notification *recipient* — preserves per-recipient ordering,
    // the order that actually matters to the worker grouping these into
    // "Ana and 12 others liked your post" within a single time window.
    partitionKey: (data) => data.userId,
  })
  const mediaQueue = createMediaQueue(env.REDIS_URL)
  const trendIngestQueue = createTrendIngestQueue(env.REDIS_URL)
  app.addHook('onClose', async () => {
    await Promise.all([
      fanoutTopic.close(),
      notificationsTopic.close(),
      mediaQueue.close(),
      trendIngestQueue.close(),
    ])
  })
  const publishNotification = (data: NotificationJobData) =>
    notificationsTopic.enqueue({ ...data, eventId: generateId().toString() })

  // Shared by posts (embedding media in a post) and media (the standalone
  // /media/:id resource) so both agree on how a storage key becomes a URL.
  const mediaUrlConfig = { bucket: env.S3_BUCKET, publicUrlBase: env.S3_ENDPOINT }

  // Created ahead of postsService below so create() can enforce a reply_policy
  // of 'following' — only postsRepository (unlike the full social-graph
  // service) is needed for that single "does X follow Y" question.
  const socialGraphRepository = createSocialGraphRepository(app.db)

  const postsRepository = createPostsRepository(app.db)
  // Created ahead of postsService (only app.db needed, not postsService
  // itself) so its findLikedPostIds/findBookmarkedPostIds can back
  // postsService's own viewerState — GET /posts/:id (ROADMAP.md 1.4).
  // interactionsService below reuses this same instance rather than a
  // second one.
  const interactionsRepository = createInteractionsRepository(app.db)
  const postsService = createPostsService(
    postsRepository,
    async (postId, authorId) => {
      await fanoutTopic.enqueue({ postId: postId.toString(), authorId: authorId.toString() })
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
    trendIngestQueue.enqueue,
    {
      findLikedPostIds: interactionsRepository.findLikedPostIds,
      findBookmarkedPostIds: interactionsRepository.findBookmarkedPostIds,
      findRepostedPostIds: postsRepository.findRepostedPostIds,
    },
    // ROADMAP.md 3.3 preventive layer — empty unless BLOCKED_TERMS is set
    // (env.ts's own comment on why nothing is hardcoded here).
    env.BLOCKED_TERMS ? env.BLOCKED_TERMS.split(',').map((term) => term.trim()) : [],
    checkMaliciousUrlsAgainstTestDomains,
  )

  const moderationRepository = createModerationRepository(app.db)
  const moderationService = createModerationService({
    repository: moderationRepository,
    mailer,
    publishNotification,
    webUrl: env.WEB_URL,
  })

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
  const profilesService = createProfilesService(profilesRepository, mediaUrlConfig, {
    // Same findFollow adapter as postsService/conversationsService above,
    // plus findFollowRequest for the "pending, not yet following" case
    // (ROADMAP.md 2.6's protected accounts) — GET /users/:username's
    // viewer.following/requested (ROADMAP.md 1.6).
    isFollowing: (followerId, followeeId) =>
      socialGraphRepository.findFollow(followerId, followeeId).then(Boolean),
    hasPendingFollowRequest: (requesterId, targetId) =>
      socialGraphRepository.findFollowRequest(requesterId, targetId).then(Boolean),
  })

  const notificationsRepository = createNotificationsRepository(app.db)
  const notificationsService = createNotificationsService(notificationsRepository, app.redis)

  const pushRepository = createPushRepository(app.db)
  const pushService = createPushService({
    repository: pushRepository,
    vapidPublicKey: env.VAPID_PUBLIC_KEY ?? null,
  })

  const realtimeService = createRealtimeService(app.redis, REALTIME_TICKET_TTL_SECONDS, {
    // Same adapter shape as apps/ws-gateway's own realtime.repository.ts,
    // wired to the real repository directly instead — this app already has
    // it for the actual conversations feature, so unlike that other
    // process there's no need to even duplicate the query, only the tiny
    // authorizeChannel switch itself (CODESTYLE.md §7).
    conversationMembership: {
      isMember: (conversationId, userId) =>
        conversationsRepository.findMember(conversationId, userId).then((row) => row !== null),
    },
  })

  const trendsRepository = createTrendsRepository(app.db)
  const trendsService = createTrendsService(trendsRepository)

  // Query-time only — apps/workers' search-indexer.worker.ts owns writing
  // to these indices (ROADMAP.md 2.3), this app only ever reads them.
  const openSearchClient = new OpenSearchClient({ node: env.OPENSEARCH_URL })
  const searchRepository = createSearchRepository(openSearchClient)
  const searchService = createSearchService(
    searchRepository,
    postsService,
    socialGraphRepository,
    {
      findLikedPostIds: interactionsRepository.findLikedPostIds,
      findBookmarkedPostIds: interactionsRepository.findBookmarkedPostIds,
      findRepostedPostIds: postsRepository.findRepostedPostIds,
    },
    // Structurally identical to BlockLookup/FollowingLookup already — same
    // no-adapter-needed reuse of socialGraphRepository as postsService above.
    socialGraphRepository,
    socialGraphRepository,
  )

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
      await registerTrendsRoutes(instance, { trendsService })
    },
    { prefix: '/v1' },
  )

  await app.register(
    async (instance) => {
      await registerSearchRoutes(instance, { searchService, tokenService })
    },
    { prefix: '/v1' },
  )

  await app.register(
    async (instance) => {
      await registerRealtimeRoutes(instance, { realtimeService, tokenService })
    },
    { prefix: '/v1' },
  )

  await app.register(
    async (instance) => {
      await registerModerationRoutes(instance, { moderationService, tokenService })
    },
    { prefix: '/v1' },
  )

  return app
}
