import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { subscribeMobilePush, unsubscribeMobilePush } from '../services/pushApi'

const MOBILE_PUSH_TOKEN_KEY = 'mobile_push_token_v1'

let listenersAttached = false
let authTokenRef = ''

function isNativeMobile() {
  try {
    if (!Capacitor?.isNativePlatform?.()) return false
    const platform = Capacitor.getPlatform?.()
    return platform === 'android' || platform === 'ios'
  } catch {
    return false
  }
}

function readStoredMobileToken() {
  if (typeof window === 'undefined') return ''
  try {
    return (window.localStorage.getItem(MOBILE_PUSH_TOKEN_KEY) || '').trim()
  } catch {
    return ''
  }
}

function writeStoredMobileToken(token) {
  if (typeof window === 'undefined') return
  try {
    if (!token) {
      window.localStorage.removeItem(MOBILE_PUSH_TOKEN_KEY)
      return
    }
    window.localStorage.setItem(MOBILE_PUSH_TOKEN_KEY, token)
  } catch {
    // Ignore localStorage failures.
  }
}

async function syncMobileTokenToBackend(pushToken) {
  const authToken = (authTokenRef || '').trim()
  const mobileToken = (pushToken || '').trim()
  if (!authToken || !mobileToken) return
  try {
    await subscribeMobilePush(authToken, {
      token: mobileToken,
      platform: Capacitor.getPlatform?.() || 'android',
    })
  } catch {
    // Ignore transient backend sync failures.
  }
}

function attachListeners() {
  if (listenersAttached || !isNativeMobile()) return
  listenersAttached = true

  PushNotifications.addListener('registration', async (token) => {
    const mobileToken = (token?.value || '').trim()
    if (!mobileToken) return
    writeStoredMobileToken(mobileToken)
    await syncMobileTokenToBackend(mobileToken)
  })

  PushNotifications.addListener('registrationError', () => {
    // Ignore registration errors; app can retry on next resume/login.
  })

  PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    clearDeliveredNativePushNotifications().catch(() => {
      // Ignore notification tray cleanup failures.
    })
    const dataUrl = action?.notification?.data?.url
    const url = typeof dataUrl === 'string' && dataUrl.trim() ? dataUrl.trim() : '/#/chat'
    if (typeof window !== 'undefined') {
      if (url.startsWith('/#')) {
        window.location.hash = url.replace('/#', '#')
      } else if (url.startsWith('#')) {
        window.location.hash = url
      } else {
        window.location.hash = '#/chat'
      }
    }
  })
}

async function clearDeliveredNativePushNotifications() {
  if (!isNativeMobile()) return
  if (typeof PushNotifications.removeAllDeliveredNotifications !== 'function') return
  try {
    await PushNotifications.removeAllDeliveredNotifications()
  } catch {
    // Ignore unsupported API failures.
  }
}

export async function syncNativePushRegistration(authToken) {
  authTokenRef = (authToken || '').trim()
  if (!isNativeMobile() || !authTokenRef) return false

  attachListeners()
  try {
    let permission = await PushNotifications.checkPermissions()
    if (permission?.receive !== 'granted') {
      permission = await PushNotifications.requestPermissions()
    }
    if (permission?.receive !== 'granted') return false

    const storedToken = readStoredMobileToken()
    if (storedToken) {
      await syncMobileTokenToBackend(storedToken)
    }

    await PushNotifications.register()
    return true
  } catch {
    return false
  }
}

export async function clearNativeDeliveredPushNotifications() {
  await clearDeliveredNativePushNotifications()
}

export async function clearNativePushRegistration(authToken) {
  authTokenRef = (authToken || '').trim()
  if (!isNativeMobile() || !authTokenRef) return
  const token = readStoredMobileToken()
  if (!token) return
  try {
    await unsubscribeMobilePush(authTokenRef, token)
  } catch {
    // Ignore cleanup failures.
  }
}
