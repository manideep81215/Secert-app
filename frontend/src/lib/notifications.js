const CHAT_NOTIFY_CUTOFFS_KEY = 'chat_notify_cutoffs_v1'

function readNotifyCutoffs() {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(CHAT_NOTIFY_CUTOFFS_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeNotifyCutoffs(next) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(CHAT_NOTIFY_CUTOFFS_KEY, JSON.stringify(next))
  } catch {
    // Ignore localStorage failures.
  }
}

function notifyCutoffKey(meUsername, peerUsername) {
  return `${(meUsername || '').trim().toLowerCase()}::${(peerUsername || '').trim().toLowerCase()}`
}

export function getNotifyCutoff(meUsername, peerUsername) {
  const key = notifyCutoffKey(meUsername, peerUsername)
  const value = readNotifyCutoffs()[key]
  return Number.isFinite(value) ? value : 0
}

export function setNotifyCutoff(meUsername, peerUsername, cutoffMs) {
  const key = notifyCutoffKey(meUsername, peerUsername)
  const current = readNotifyCutoffs()
  const existing = Number.isFinite(current[key]) ? current[key] : 0
  if (cutoffMs <= existing) return
  current[key] = cutoffMs
  writeNotifyCutoffs(current)
}

export async function ensureNotificationPermission(interactive = false) {
  if (typeof window === 'undefined' || !('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  if (!interactive) return false

  try {
    const permission = await Notification.requestPermission()
    return permission === 'granted'
  } catch {
    return false
  }
}

export async function pushNotify(title, body) {
  const hasPermission = await ensureNotificationPermission(false)
  if (!hasPermission) return false

  const chatUrl = `${window.location.origin}/#/chat`

  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready
      if (registration) {
        await registration.showNotification(title, {
          body,
          tag: `chat-${Date.now()}`,
          renotify: false,
          data: { url: chatUrl },
        })
        return true
      }
    }
  } catch {
    // Fall back to window notifications.
  }

  try {
    const notification = new Notification(title, { body })
    notification.onclick = () => {
      window.focus()
      window.location.hash = '/chat'
      notification.close()
    }
    return true
  } catch {
    // Ignore browser notification errors.
    return false
  }
}
