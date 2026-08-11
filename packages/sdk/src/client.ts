import createFetchClient, { type Middleware } from 'openapi-fetch'
import type { paths } from './types.gen.js'

export type ApiClient = ReturnType<typeof createFetchClient<paths>>

export type CreateApiClientOptions = {
  baseUrl: string
  /** Reads the current access token for the `Authorization` header — kept out of the SDK's own state so web and mobile can each plug in their own token storage. */
  getAccessToken?: () => string | null
}

/**
 * Typed API client generated from the OpenAPI document `apps/api` publishes
 * (`pnpm --filter @x/api generate:openapi`, then `pnpm --filter @x/sdk generate`).
 * Shared by `apps/web` and, once it exists, `apps/mobile` — SPECS.md §18.
 */
export function createApiClient(options: CreateApiClientOptions): ApiClient {
  const client = createFetchClient<paths>({ baseUrl: options.baseUrl, credentials: 'include' })

  if (options.getAccessToken) {
    const authMiddleware: Middleware = {
      async onRequest({ request }) {
        const token = options.getAccessToken?.()
        if (token) {
          request.headers.set('Authorization', `Bearer ${token}`)
        }
        return request
      },
    }
    client.use(authMiddleware)
  }

  return client
}
