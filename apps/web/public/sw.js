// Web Push service worker (ROADMAP.md 2.9). Registered on demand from
// lib/use-push-subscription.ts when the user opts in — not on every page
// load, since most visitors never touch push at all.

self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload
  try {
    payload = event.data.json()
  } catch {
    return
  }

  const { title, body, url } = payload
  event.waitUntil(
    self.registration.showNotification(title || 'X', {
      body: body || '',
      data: { url: url || '/' },
    }),
  )
})

// Focuses an already-open tab on that URL if there is one, otherwise opens
// a new one — the usual "notification click" convention.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url === targetUrl && 'focus' in client) return client.focus()
      }
      return self.clients.openWindow(targetUrl)
    }),
  )
})
