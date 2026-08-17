import { describe, expect, it } from 'vitest'
import { reportRumMetricRequestSchema } from './rum.js'

describe('reportRumMetricRequestSchema', () => {
  it('accepts a real LCP report', () => {
    expect(
      reportRumMetricRequestSchema.safeParse({
        metric: 'LCP',
        value: 1234.5,
        rating: 'good',
        path: '/[username]',
        navigationType: 'navigate',
      }).success,
    ).toBe(true)
  })

  it('rejects an unknown metric name', () => {
    expect(
      reportRumMetricRequestSchema.safeParse({
        metric: 'BOGUS',
        value: 1,
        rating: 'good',
        path: '/',
        navigationType: 'navigate',
      }).success,
    ).toBe(false)
  })

  it('rejects an unknown rating', () => {
    expect(
      reportRumMetricRequestSchema.safeParse({
        metric: 'CLS',
        value: 0.05,
        rating: 'excellent',
        path: '/',
        navigationType: 'navigate',
      }).success,
    ).toBe(false)
  })

  it('rejects a non-finite value', () => {
    expect(
      reportRumMetricRequestSchema.safeParse({
        metric: 'CLS',
        value: Number.POSITIVE_INFINITY,
        rating: 'good',
        path: '/',
        navigationType: 'navigate',
      }).success,
    ).toBe(false)
  })

  it('rejects an empty path', () => {
    expect(
      reportRumMetricRequestSchema.safeParse({
        metric: 'CLS',
        value: 0.05,
        rating: 'good',
        path: '',
        navigationType: 'navigate',
      }).success,
    ).toBe(false)
  })

  it('rejects a path over 200 characters', () => {
    expect(
      reportRumMetricRequestSchema.safeParse({
        metric: 'CLS',
        value: 0.05,
        rating: 'good',
        path: `/${'a'.repeat(200)}`,
        navigationType: 'navigate',
      }).success,
    ).toBe(false)
  })
})
