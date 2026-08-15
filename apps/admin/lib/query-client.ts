import { QueryClient } from '@tanstack/react-query'

/** Same defaults as apps/web's own lib/query-client.ts (SPECS.md §7.1). */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: 2,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
      },
    },
  })
}
