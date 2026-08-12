'use client'

import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { apiClient } from './api-client'

export type PushSubscriptionState = 'unsupported' | 'unsubscribed' | 'subscribed'

/**
 * VAPID application server keys are base64url; PushManager wants raw bytes.
 * Built via `new Uint8Array(length)` rather than `Uint8Array.from(...)` —
 * the latter's return type widens to `Uint8Array<ArrayBufferLike>`, which
 * `PushSubscriptionOptionsInit.applicationServerKey` (a `BufferSource`)
 * rejects under TypeScript's stricter typed-array generics.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const base64Safe = `${base64}${padding}`.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64Safe)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i)
  }
  return bytes
}

export function useVapidPublicKey() {
  return useQuery({
    queryKey: ['push', 'vapid-public-key'],
    queryFn: async () => {
      // No error responses declared for this route (push.routes.ts), so
      // openapi-fetch never types an `error` branch — only a genuine
      // network/parse failure leaves `data` empty here.
      const { data } = await apiClient.GET('/push/vapid-public-key')
      if (!data) throw new Error('failed to reach the API')
      return data.data.publicKey
    },
  })
}

/**
 * Wraps the Push API (ROADMAP.md 2.9). Whether this device already has a
 * live subscription lives in the browser's own service-worker registration,
 * not our API — reading it is a DOM read, the same "not really data
 * fetching" carve-out CODESTYLE.md §11 already makes for e.g. blurhash
 * canvas decoding, so it's a useEffect rather than a TanStack Query.
 */
export function usePushSubscription() {
  const { data: vapidPublicKey } = useVapidPublicKey()
  const [state, setState] = useState<PushSubscriptionState>('unsubscribed')
  const [isPending, setIsPending] = useState(false)
  const isSupported =
    typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window

  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above — this reads a browser API's own state on mount, not a reactive dependency chain.
  useEffect(() => {
    if (!isSupported) {
      setState('unsupported')
      return
    }
    let cancelled = false
    navigator.serviceWorker.getRegistration('/sw.js').then(async (registration) => {
      const subscription = await registration?.pushManager.getSubscription()
      if (!cancelled) setState(subscription ? 'subscribed' : 'unsubscribed')
    })
    return () => {
      cancelled = true
    }
  }, [])

  const subscribe = useCallback(async () => {
    if (!vapidPublicKey) return
    setIsPending(true)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') return

      const registration = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      })
      const json = subscription.toJSON()
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return

      const { error } = await apiClient.POST('/push/subscriptions', {
        body: { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } },
      })
      if (error) throw new Error(error.error.message)
      setState('subscribed')
    } finally {
      setIsPending(false)
    }
  }, [vapidPublicKey])

  const unsubscribe = useCallback(async () => {
    setIsPending(true)
    try {
      const registration = await navigator.serviceWorker.getRegistration('/sw.js')
      const subscription = await registration?.pushManager.getSubscription()
      if (subscription) {
        await apiClient.DELETE('/push/subscriptions', { body: { endpoint: subscription.endpoint } })
        await subscription.unsubscribe()
      }
      setState('unsubscribed')
    } finally {
      setIsPending(false)
    }
  }, [])

  return {
    isSupported,
    isConfigured: Boolean(vapidPublicKey),
    state,
    isPending,
    subscribe,
    unsubscribe,
  }
}
