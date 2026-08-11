'use client'

import { type InfiniteData, useMutation, useQueryClient } from '@tanstack/react-query'
import type { CreatePostInput, Post } from '@x/contracts'
import { apiClient } from './api-client'

type TimelinePage = {
  data: Post[]
  meta: { nextCursor: string | null; prevCursor: string | null; hasMore: boolean }
}

/** POST /posts — on success, prepends the real created post to the home timeline cache. */
export function useCreatePost() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreatePostInput) => {
      // exactOptionalPropertyTypes: same conditional-spread pattern as
      // use-timeline.ts — the generated body type's optional fields don't
      // accept an explicit `undefined`.
      const { data, error } = await apiClient.POST('/posts', {
        body: {
          ...(input.text !== undefined && { text: input.text }),
          ...(input.mediaIds !== undefined && { mediaIds: input.mediaIds }),
          ...(input.inReplyToId !== undefined && { inReplyToId: input.inReplyToId }),
          ...(input.quotedPostId !== undefined && { quotedPostId: input.quotedPostId }),
          replyPolicy: input.replyPolicy,
          isSensitive: input.isSensitive,
        },
      })
      if (error) throw new Error(error.error.message)
      return data.data
    },
    onSuccess: (post) => {
      queryClient.setQueriesData<InfiniteData<TimelinePage>>(
        { queryKey: ['timeline', 'home'] },
        (old) => {
          const [firstPage, ...rest] = old?.pages ?? []
          if (!old || !firstPage) return old
          return { ...old, pages: [{ ...firstPage, data: [post, ...firstPage.data] }, ...rest] }
        },
      )
    },
  })
}
