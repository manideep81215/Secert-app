const CHAT_NOTIFY_CUTOFFS_KEY = 'chat_notify_cutoffs_v1'

function isCapacitorNative() {
  if (typeof window === 'undefined') return false
  const cap = window.Capacitor
  if (!cap) return false
  if (typeof cap.isNativePlatform === 'function') return cap.isNativePlatform()
  return cap.getPlatform?.() === 'android' || cap.getPlatform?.() === 'ios'
}

async function getCapacitorLocalNotifications() {
  try {
    const moduleName = '@capacitor/local-notifications'
    const mod = await import(/* @vite-ignore */ moduleName)
    return mod.LocalNotifications || null
  } catch {
    return null
  }
}

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
  if (isCapacitorNative()) {
    const localNotifications = await getCapacitorLocalNotifications()
    if (!localNotifications) return false
    try {
      const status = await localNotifications.checkPermissions()
      if (status?.display === 'granted') return true
      if (!interactive) return false
      const requested = await localNotifications.requestPermissions()
      return requested?.display === 'granted'
    } catch {
      return false
    }
  }

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

export function getNotificationPermissionState() {
  if (isCapacitorNative()) return 'native'
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission || 'default'
}

export function getNotificationBlockedHelp() {
  if (typeof window === 'undefined') return 'Notifications are blocked. Enable them in browser/app settings and reload.'
  const ua = window.navigator.userAgent.toLowerCase()
  const isAndroid = /android/.test(ua)
  const isIos = /iphone|ipad|ipod/.test(ua)
  const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true

  if (isIos && isStandalone) {
    return 'Notifications are blocked. On iPhone: Settings > Notifications > this app > Allow Notifications, then reopen the app.'
  }
  if (isAndroid && isStandalone) {
    return 'Notifications are blocked. On Android: long-press app icon > App info > Notifications > Allow, then reopen the app.'
  }
  return 'Notifications are blocked. Open browser Site settings for this app URL and set Notifications to Allow, then reload.'
}

export async function pushNotify(title, body) {
  const hasPermission = await ensureNotificationPermission(false)
  if (!hasPermission) return false

  if (isCapacitorNative()) {
    const localNotifications = await getCapacitorLocalNotifications()
    if (!localNotifications) return false
    try {
      await localNotifications.schedule({
        notifications: [
          {
            id: Math.floor(Date.now() % 2147483000),
            title: title || 'New message',
            body: body || '',
            schedule: { at: new Date(Date.now() + 100) },
            smallIcon: 'ic_launcher',
            actionTypeId: 'chat',
            extra: { url: '/#/chat' },
          },
        ],
      })
      return true
    } catch {
      return false
    }
  }

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
