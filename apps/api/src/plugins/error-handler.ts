import { AppError } from '@x/utils'
import type { FastifyError, FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'

/**
 * Single translation point from `AppError` (or anything unexpected) to an
 * HTTP response — CODESTYLE.md §9. Routes and services throw; only this
 * plugin knows about status codes and the wire error shape.
 */
export default fp(async function errorHandlerPlugin(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      request.log.info({ err: error, context: error.context }, error.message)
      return reply.status(error.httpStatus).send({
        error: {
          code: error.code,
          message: error.message,
          ...(Object.keys(error.context).length > 0 ? { details: error.context } : {}),
          requestId: request.id,
        },
      })
    }

    // Fastify's own validation errors (from the zod type provider) surface
    // here as plain Error with a `validation` property — treat them the same
    // as a 400 instead of falling through to the 500 branch.
    if (error.validation) {
      request.log.info({ err: error }, 'request validation failed')
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message,
          requestId: request.id,
        },
      })
    }

    request.log.error({ err: error }, 'unhandled error')
    return reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong on our end.',
        requestId: request.id,
      },
    })
  })
})
