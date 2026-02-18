self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
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
