import { getPushPublicKey, subscribePush } from '../services/pushApi'

function base64UrlToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i)
  }
  return output
}

export async function ensurePushSubscription(token) {
  if (!token) return false
  if (typeof window === 'undefined') return false
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return false
  if (Notification.permission !== 'granted') return false

  const config = await getPushPublicKey()
  if (!config?.enabled || !config?.publicKey) return false

  const registration = await navigator.serviceWorker.ready
  if (!registration?.pushManager) return false

  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(config.publicKey),
    })
  }

  const json = subscription.toJSON()
  if (!json?.endpoint || !json?.keys?.p256dh || !json?.keys?.auth) return false

  await subscribePush(token, {
    endpoint: json.endpoint,
    keys: {
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
  })
  return true
}
