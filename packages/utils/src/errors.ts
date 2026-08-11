// Error hierarchy shared by every service — CODESTYLE.md §9. A single Fastify
// error handler translates these to HTTP responses; internal code never
// throws a bare string or a plain Error for an expected failure.
export abstract class AppError extends Error {
  abstract readonly code: string
  abstract readonly httpStatus: number

  constructor(
    message: string,
    readonly context: Record<string, unknown> = {},
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = new.target.name
  }
}

export class ValidationError extends AppError {
  readonly code = 'VALIDATION_ERROR'
  readonly httpStatus = 400
}

export class UnauthenticatedError extends AppError {
  readonly code = 'UNAUTHENTICATED'
  readonly httpStatus = 401
}

export class ForbiddenError extends AppError {
  readonly code = 'FORBIDDEN'
  readonly httpStatus = 403
}

export class BlockedByUserError extends AppError {
  readonly code = 'BLOCKED_BY_USER'
  readonly httpStatus = 403
}

export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND'
  readonly httpStatus = 404

  constructor(resource: string, id: string, context: Record<string, unknown> = {}) {
    super(`${resource} ${id} not found`, { resource, id, ...context })
  }
}

export class ConflictError extends AppError {
  readonly code = 'CONFLICT'
  readonly httpStatus = 409
}

export class UnprocessableError extends AppError {
  readonly code = 'UNPROCESSABLE'
  readonly httpStatus = 422
}

export class RateLimitError extends AppError {
  readonly code = 'RATE_LIMIT_EXCEEDED'
  readonly httpStatus = 429

  constructor(
    message: string,
    readonly retryAfterSeconds: number,
    context: Record<string, unknown> = {},
  ) {
    super(message, { retryAfterSeconds, ...context })
  }
}

export class ServiceUnavailableError extends AppError {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly httpStatus = 503
}
