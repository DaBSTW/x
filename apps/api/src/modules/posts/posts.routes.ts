import {
  createPostSchema,
  createThreadSchema,
  errorResponseSchema,
  paginationQuerySchema,
  postListResponseSchema,
  postResponseSchema,
  postThreadResponseSchema,
  profilePostsQuerySchema,
  snowflakeIdSchema,
  threadResponseSchema,
} from '@x/contracts'
import { decodeCursor, encodeCursor } from '@x/utils'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { withIdempotency } from '../../lib/idempotency.js'
import {
  createOptionalAuth,
  createRequireAuth,
  getAuthenticatedUser,
} from '../../middleware/require-auth.js'
import type { TokenService } from '../../plugins/tokens.js'
import type { PostsService } from './posts.service.js'

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60

export type PostsRoutesOptions = {
  postsService: PostsService
  tokenService: TokenService
}

export async function registerPostsRoutes(app: FastifyInstance, options: PostsRoutesOptions) {
  const { postsService, tokenService } = options
  const requireAuth = createRequireAuth(tokenService)
  const optionalAuth = createOptionalAuth(tokenService)
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.post(
    '/posts',
    {
      schema: {
        body: createPostSchema,
        headers: z.object({ 'idempotency-key': z.string().uuid().optional() }),
        response: {
          201: postResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      const idempotencyKey = request.headers['idempotency-key']

      const create = () =>
        postsService.create(user.id, {
          text: request.body.text ?? '',
          mediaIds: request.body.mediaIds?.map((id) => BigInt(id)),
          inReplyToId: request.body.inReplyToId ? BigInt(request.body.inReplyToId) : undefined,
          quotedPostId: request.body.quotedPostId ? BigInt(request.body.quotedPostId) : undefined,
          replyPolicy: request.body.replyPolicy,
          isSensitive: request.body.isSensitive,
        })

      const post = idempotencyKey
        ? (
            await withIdempotency(
              app.redis,
              `post:create:${user.id}:${idempotencyKey}`,
              IDEMPOTENCY_TTL_SECONDS,
              create,
            )
          ).result
        : await create()

      return reply.status(201).send({ data: post })
    },
  )

  server.post(
    '/posts/batch',
    {
      schema: {
        body: createThreadSchema,
        headers: z.object({ 'idempotency-key': z.string().uuid().optional() }),
        response: {
          201: threadResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      const idempotencyKey = request.headers['idempotency-key']

      const createThread = () =>
        postsService.createThread(user.id, {
          posts: request.body.posts.map((item) => ({
            text: item.text ?? '',
            mediaIds: item.mediaIds?.map((id) => BigInt(id)),
            isSensitive: item.isSensitive,
          })),
          inReplyToId: request.body.inReplyToId ? BigInt(request.body.inReplyToId) : undefined,
          replyPolicy: request.body.replyPolicy,
        })

      const thread = idempotencyKey
        ? (
            await withIdempotency(
              app.redis,
              `post:batch:${user.id}:${idempotencyKey}`,
              IDEMPOTENCY_TTL_SECONDS,
              createThread,
            )
          ).result
        : await createThread()

      return reply.status(201).send({ data: thread })
    },
  )

  server.get(
    '/posts/:id',
    {
      schema: {
        params: z.object({ id: snowflakeIdSchema }),
        response: { 200: postResponseSchema, 404: errorResponseSchema },
      },
      // Public route, personalized when signed in — a caller blocked by (or
      // blocking) this post's author gets the same 404 as a deleted post
      // (ROADMAP.md 2.6).
      preHandler: [optionalAuth],
    },
    async (request, reply) => {
      const post = await postsService.getById(BigInt(request.params.id), request.user?.id)
      return reply.send({ data: post })
    },
  )

  server.get(
    '/posts/:id/thread',
    {
      schema: {
        params: z.object({ id: snowflakeIdSchema }),
        response: { 200: postThreadResponseSchema, 404: errorResponseSchema },
      },
      preHandler: [optionalAuth],
    },
    async (request, reply) => {
      const thread = await postsService.getThread(BigInt(request.params.id), request.user?.id)
      return reply.send({
        data: {
          ancestors: thread.ancestors,
          post: thread.post,
          replies: thread.replies,
          meta: { hasMoreReplies: thread.hasMoreReplies },
        },
      })
    },
  )

  server.get(
    '/posts/:id/replies',
    {
      schema: {
        params: z.object({ id: snowflakeIdSchema }),
        querystring: paginationQuerySchema,
        response: { 200: postListResponseSchema, 404: errorResponseSchema },
      },
      preHandler: [optionalAuth],
    },
    async (request, reply) => {
      const cursor = request.query.cursor ? decodeCursor(request.query.cursor) : null
      const { items, hasMore } = await postsService.listReplies(
        BigInt(request.params.id),
        request.query.limit,
        cursor,
        request.user?.id,
      )
      const lastItem = items.at(-1)
      const nextCursor = hasMore && lastItem ? encodeCursor(BigInt(lastItem.id)) : null
      return reply.send({ data: items, meta: { nextCursor, prevCursor: null, hasMore } })
    },
  )

  server.delete(
    '/posts/:id',
    {
      schema: {
        params: z.object({ id: snowflakeIdSchema }),
        response: {
          204: z.null(),
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const user = getAuthenticatedUser(request)
      await postsService.remove(BigInt(request.params.id), user.id)
      return reply.status(204).send(null)
    },
  )

  server.get(
    '/users/:username/posts',
    {
      schema: {
        params: z.object({ username: z.string() }),
        querystring: profilePostsQuerySchema,
        response: { 200: postListResponseSchema, 404: errorResponseSchema },
      },
      preHandler: [optionalAuth],
    },
    async (request, reply) => {
      const cursor = request.query.cursor ? decodeCursor(request.query.cursor) : null
      const { items, hasMore } = await postsService.listByUsername(
        request.params.username.toLowerCase(),
        request.query.limit,
        cursor,
        request.query.filter,
        request.user?.id,
      )
      const lastItem = items.at(-1)
      const nextCursor = hasMore && lastItem ? encodeCursor(BigInt(lastItem.id)) : null

      return reply.send({ data: items, meta: { nextCursor, prevCursor: null, hasMore } })
    },
  )
}
