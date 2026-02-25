import { toast } from 'react-toastify'

const TOAST_WINDOW_MS = 15000
const TOAST_MAX_PER_WINDOW = 3
const trackedToasts = new Map()

function cleanupExpired(now) {
  for (const [key, value] of trackedToasts.entries()) {
    if (now > value.resetAt) {
      trackedToasts.delete(key)
    }
  }
}

function shouldAllowToast(kind, content, options) {
  const now = Date.now()
  cleanupExpired(now)

  const stablePart = options?.toastId || String(content || '').trim()
  const key = `${kind}:${stablePart}`
  const current = trackedToasts.get(key)

  if (!current || now > current.resetAt) {
    trackedToasts.set(key, {
      count: 1,
      resetAt: now + TOAST_WINDOW_MS,
    })
    return true
  }

  if (current.count >= TOAST_MAX_PER_WINDOW) {
    return false
  }

  current.count += 1
  trackedToasts.set(key, current)
  return true
}

export function installToastGuard() {
  if (globalThis.__toastGuardInstalled) return
  globalThis.__toastGuardInstalled = true

  const methods = ['error', 'warn', 'info', 'success']
  methods.forEach((kind) => {
    const original = toast[kind]?.bind(toast)
    if (!original) return
    toast[kind] = (content, options) => {
      if (!shouldAllowToast(kind, content, options)) return null
      return original(content, options)
    }
  })
}
