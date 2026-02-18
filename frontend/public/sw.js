self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = {}
  }

  const title = payload.title || 'New message'
  const body = payload.body || 'You have a new message.'
  const url = payload.url || `${self.location.origin}/#/chat`

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: `push-${Date.now()}`,
      data: { url },
      renotify: false,
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const targetUrl = event.notification?.data?.url || `${self.location.origin}/#/chat`

  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clientsList) {
      try {
        if ('navigate' in client) {
          await client.navigate(targetUrl)
        }
        await client.focus()
        return
      } catch {
        // Try next client.
      }
    }
    await self.clients.openWindow(targetUrl)
  })())
})
