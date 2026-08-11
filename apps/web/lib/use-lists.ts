'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './api-client'

/** GET /users/{username}/lists (ROADMAP.md 2.8) — bounded batch like use-follow.ts's suggestions, not cursor-paginated in the UI yet. */
export function useUserLists(username: string | undefined) {
  return useQuery({
    queryKey: ['lists', 'by-owner', username],
    enabled: username !== undefined,
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/users/{username}/lists', {
        params: { path: { username: username as string }, query: { limit: 50 } },
      })
      if (error) throw new Error(error.error.message)
      return data.data
    },
  })
}

/** GET /lists/{id} — `null` (not thrown) for a 404, so the page can tell "not found" apart from "still loading" or a real error. */
export function useList(id: string) {
  return useQuery({
    queryKey: ['lists', id],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/lists/{id}', { params: { path: { id } } })
      if (error) {
        if (error.error.code === 'NOT_FOUND') return null
        throw new Error(error.error.message)
      }
      return data.data
    },
  })
}

export function useCreateList() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name: string; description?: string; isPrivate: boolean }) => {
      const { data, error } = await apiClient.POST('/lists', { body: input })
      if (error) throw new Error(error.error.message)
      return data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lists', 'by-owner'] })
    },
  })
}

export function useDeleteList() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await apiClient.DELETE('/lists/{id}', { params: { path: { id } } })
      if (error) throw new Error(error.error.message)
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['lists', 'by-owner'] })
      queryClient.removeQueries({ queryKey: ['lists', id] })
    },
  })
}
