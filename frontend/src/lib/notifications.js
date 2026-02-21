import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'

const CHAT_NOTIFY_CUTOFFS_KEY = 'chat_notify_cutoffs_v1'
const NATIVE_CHAT_CHANNEL_ID = 'chat_messages'
let nativeNotificationSetupDone = false

function isCapacitorNative() {
  try {
    return Capacitor?.isNativePlatform?.() === true
  } catch {
    return false
  }
}

async function ensureNativeNotificationSetup(localNotifications) {
  if (nativeNotificationSetupDone || !localNotifications) return
  try {
    await localNotifications.createChannel({
      id: NATIVE_CHAT_CHANNEL_ID,
      name: 'Chat messages',
      description: 'Incoming chat message alerts',
      importance: 5,
      visibility: 1,
    })
  } catch {
    // Ignore channel creation failures on unsupported/older devices.
  }

  try {
    await localNotifications.registerActionTypes({
      types: [
        {
          id: 'chat',
          actions: [{ id: 'open-chat', title: 'Open chat' }],
        },
      ],
    })
  } catch {
    // Ignore action registration failures.
  }

  nativeNotificationSetupDone = true
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
    try {
      const status = await LocalNotifications.checkPermissions()
      if (status?.display === 'granted') return true
      if (!interactive) return false
      const requested = await LocalNotifications.requestPermissions()
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
  if (isCapacitorNative()) {
    await ensureNativeNotificationSetup(LocalNotifications)
    const hasPermission = await ensureNotificationPermission(false)
    if (!hasPermission) return false

    const notificationId = Math.floor(Date.now() % 2147483000)
    const baseNotification = {
      id: notificationId,
      title: title || 'New message',
      body: body || '',
      schedule: { at: new Date(Date.now() + 50), allowWhileIdle: true },
      channelId: NATIVE_CHAT_CHANNEL_ID,
      actionTypeId: 'chat',
      extra: { url: '/#/chat' },
    }

    try {
      await LocalNotifications.schedule({
        notifications: [
          {
            ...baseNotification,
            // Android status-bar small icon should be monochrome/simple.
            smallIcon: 'ic_launcher_foreground',
            largeIcon: 'simp_games_quest_logo',
          },
        ],
      })
      return true
    } catch (errorPrimary) {
      // Fallback for devices/ROMs that reject custom icon resources.
      try {
        await LocalNotifications.schedule({
          notifications: [
            {
              ...baseNotification,
              smallIcon: 'ic_launcher',
            },
          ],
        })
        return true
      } catch (errorSecondary) {
        try {
          await LocalNotifications.schedule({
            notifications: [baseNotification],
          })
          return true
        } catch (errorFinal) {
          console.warn('[notify] Native notification failed', {
            errorPrimary,
            errorSecondary,
            errorFinal,
          })
          return false
        }
      }
    }
  }

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
