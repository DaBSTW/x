import { describe, expect, it } from 'vitest'
import {
  ConflictError,
  NotFoundError,
  RateLimitError,
  UnauthenticatedError,
  ValidationError,
} from './errors.js'

describe('AppError subclasses', () => {
  it('carries a stable code and HTTP status', () => {
    const error = new ValidationError('bad input', { field: 'email' })

    expect(error.code).toBe('VALIDATION_ERROR')
    expect(error.httpStatus).toBe(400)
    expect(error.context).toEqual({ field: 'email' })
    expect(error.name).toBe('ValidationError')
  })

  it('preserves the original cause', () => {
    const cause = new Error('connection reset')
    const error = new UnauthenticatedError('token invalid', {}, { cause })

    expect(error.cause).toBe(cause)
  })

  it('formats a NotFoundError with the resource and id in context', () => {
    const error = new NotFoundError('post', '123', { viewerId: '456' })

    expect(error.message).toBe('post 123 not found')
    expect(error.context).toEqual({ resource: 'post', id: '123', viewerId: '456' })
    expect(error.httpStatus).toBe(404)
  })

  it('carries retryAfterSeconds for RateLimitError', () => {
    const error = new RateLimitError('too many requests', 300)

    expect(error.retryAfterSeconds).toBe(300)
    expect(error.context.retryAfterSeconds).toBe(300)
  })

  it('is an instanceof Error', () => {
    expect(new ConflictError('already following')).toBeInstanceOf(Error)
  })
})
