'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './api-client'

/** Thrown by useAddListMember when the typed username doesn't resolve to a real account — kept distinct from a plain "not found" Error so the form can tell "no such user" apart from any other failure (a list that's since been deleted, a network error) and phrase each one accordingly. */
export class UnknownUsernameError extends Error {}

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

/** GET /lists/{id}/members (ROADMAP.md 2.8) — bounded batch like useUserLists, not cursor-paginated in the UI yet: a list's own membership is the thing being managed here, not scrolled through. */
export function useListMembers(id: string) {
  return useQuery({
    queryKey: ['lists', id, 'members'],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/lists/{id}/members', {
        params: { path: { id }, query: { limit: 50 } },
      })
      if (error) throw new Error(error.error.message)
      return data.data
    },
  })
}

/**
 * Adds a member by username, not id — the only identifier a list owner
 * actually has in hand (ROADMAP.md 2.8's "a simple input would do", no
 * search UI yet). Resolves it via GET /users/{username} first, the same
 * public lookup the profile page itself uses, then POST /lists/{id}/members/{userId}.
 */
export function useAddListMember() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ listId, username }: { listId: string; username: string }) => {
      const profile = await apiClient.GET('/users/{username}', {
        params: { path: { username } },
      })
      if (profile.error) {
        if (profile.error.error.code === 'NOT_FOUND') {
          throw new UnknownUsernameError(`no existe ninguna cuenta @${username}`)
        }
        throw new Error(profile.error.error.message)
      }

      const { error } = await apiClient.POST('/lists/{id}/members/{userId}', {
        params: { path: { id: listId, userId: profile.data.data.id } },
      })
      if (error) throw new Error(error.error.message)
      return profile.data.data
    },
    onSuccess: (_member, { listId }) => {
      queryClient.invalidateQueries({ queryKey: ['lists', listId, 'members'] })
      queryClient.invalidateQueries({ queryKey: ['lists', listId] })
    },
  })
}

export function useRemoveListMember() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ listId, userId }: { listId: string; userId: string }) => {
      const { error } = await apiClient.DELETE('/lists/{id}/members/{userId}', {
        params: { path: { id: listId, userId } },
      })
      if (error) throw new Error(error.error.message)
    },
    onSuccess: (_data, { listId }) => {
      queryClient.invalidateQueries({ queryKey: ['lists', listId, 'members'] })
      queryClient.invalidateQueries({ queryKey: ['lists', listId] })
    },
  })
}
