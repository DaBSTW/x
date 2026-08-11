import { createApiClient } from '@x/sdk'

// SSR runs inside the same Next.js process the browser would otherwise call
// from, and today's local-dev topology has apps/api and apps/web both bound
// to localhost — so this reuses the same URL as the browser client. If
// apps/api and apps/web ever get containerized behind separate internal and
// public hostnames, this is the one place that would need to split.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/v1'

/**
 * A server-only client for Server Components (the profile page's SSR fetch,
 * ROADMAP.md 1.6) — no `getAccessToken`, unlike `./api-client.ts`'s browser
 * singleton. Never import that one here: it reads a client-only Zustand
 * store, which must not become shared mutable state across concurrent
 * server requests. Every route this client calls must stay genuinely
 * public — packages/contracts' userProfileSchema has no viewer-only field,
 * so GET /users/:username qualifies.
 */
export const serverApiClient = createApiClient({ baseUrl: API_BASE_URL })
