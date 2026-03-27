import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'react-toastify/dist/ReactToastify.css'
import './styles/base.css'
import App from './App.jsx'
import AppErrorBoundary from './components/AppErrorBoundary.jsx'
import { installToastGuard } from './lib/toastGuard'

if (typeof globalThis.global === 'undefined') {
  globalThis.global = globalThis
}

installToastGuard()

const isNativeCapacitorRuntime = () => {
  if (typeof window === 'undefined') return false
  const cap = window.Capacitor
  if (!cap) return false
  if (typeof cap.isNativePlatform === 'function') {
    return Boolean(cap.isNativePlatform())
  }
  const platform = cap.getPlatform?.()
  return platform === 'android' || platform === 'ios'
}

const configureNativeKeyboardBehavior = async () => {
  if (!isNativeCapacitorRuntime()) return
  const cap = window?.Capacitor
  const platform = cap?.getPlatform?.()
  if (platform !== 'android') return

  try {
    const mod = await import('@capacitor/keyboard')
    const Keyboard = mod?.Keyboard
    const KeyboardResize = mod?.KeyboardResize
    if (!Keyboard) return

    // Keep WebView height stable on Android to prevent white gap above keyboard.
    if (KeyboardResize?.None && Keyboard?.setResizeMode) {
      await Keyboard.setResizeMode({ mode: KeyboardResize.None })
    }
    if (Keyboard?.setScroll) {
      await Keyboard.setScroll({ isDisabled: false })
    }
  } catch {
    // Ignore keyboard plugin setup failures in non-native/web contexts.
  }
}

const markNativeRuntimeClasses = () => {
  if (!isNativeCapacitorRuntime()) return
  const platform = window?.Capacitor?.getPlatform?.()
  const html = document.documentElement
  const body = document.body
  if (!html || !body) return
  html.classList.add('native-runtime')
  body.classList.add('native-runtime')
  if (platform === 'android') {
    html.classList.add('native-android-runtime')
    body.classList.add('native-android-runtime')
  } else if (platform === 'ios') {
    html.classList.add('native-ios-runtime')
    body.classList.add('native-ios-runtime')
  }
}

const getFirstPositiveViewportValue = (...values) => {
  for (const value of values) {
    const next = Math.round(Number(value || 0))
    if (next > 0) return next
  }
  return 0
}

const syncNativeViewportCssVars = () => {
  if (typeof window === 'undefined' || !isNativeCapacitorRuntime()) return () => {}

  const html = document.documentElement
  if (!html) return () => {}

  const applyViewportSize = () => {
    const viewportHeight = getFirstPositiveViewportValue(
      window.visualViewport?.height,
      window.innerHeight,
      document.documentElement?.clientHeight,
    )
    const viewportWidth = getFirstPositiveViewportValue(
      window.visualViewport?.width,
      window.innerWidth,
      document.documentElement?.clientWidth,
    )

    if (viewportHeight > 0) {
      html.style.setProperty('--native-app-height', `${viewportHeight}px`)
    }
    if (viewportWidth > 0) {
      html.style.setProperty('--native-app-width', `${viewportWidth}px`)
    }
  }

  let rafId = 0
  const queueApplyViewportSize = () => {
    if (rafId) cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(() => {
      rafId = 0
      applyViewportSize()
    })
  }

  applyViewportSize()

  const viewport = window.visualViewport
  viewport?.addEventListener('resize', queueApplyViewportSize)
  viewport?.addEventListener('scroll', queueApplyViewportSize)
  window.addEventListener('resize', queueApplyViewportSize)
  window.addEventListener('orientationchange', queueApplyViewportSize)
  window.addEventListener('focusin', queueApplyViewportSize)
  window.addEventListener('focusout', queueApplyViewportSize)

  return () => {
    if (rafId) cancelAnimationFrame(rafId)
    viewport?.removeEventListener('resize', queueApplyViewportSize)
    viewport?.removeEventListener('scroll', queueApplyViewportSize)
    window.removeEventListener('resize', queueApplyViewportSize)
    window.removeEventListener('orientationchange', queueApplyViewportSize)
    window.removeEventListener('focusin', queueApplyViewportSize)
    window.removeEventListener('focusout', queueApplyViewportSize)
  }
}

markNativeRuntimeClasses()
configureNativeKeyboardBehavior()
syncNativeViewportCssVars()

if ('serviceWorker' in navigator) {
  if (isNativeCapacitorRuntime()) {
    // Avoid stale cached bundles in Capacitor WebView.
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister())
    }).catch(() => {
      // Ignore service worker cleanup failures in native runtime.
    })
    if (typeof window !== 'undefined' && 'caches' in window) {
      window.caches.keys().then((keys) => {
        keys.forEach((key) => {
          window.caches.delete(key).catch(() => {
            // Ignore cache delete failures.
          })
        })
      }).catch(() => {
        // Ignore cache access failures.
      })
    }
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Ignore service worker registration failures in local dev.
      })
    })
  }
}

const rootEl = document.getElementById('root')
createRoot(rootEl).render(
  <StrictMode>
    <HashRouter>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </HashRouter>
  </StrictMode>,
)

const hideStartupSplash = () => {
  const splash = document.getElementById('app-splash')
  if (!splash) return
  splash.classList.add('app-splash-hidden')
  window.setTimeout(() => {
    splash.remove()
  }, 260)
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  window.requestAnimationFrame(() => {
    hideStartupSplash()
  })
} else {
  window.addEventListener('DOMContentLoaded', () => {
    window.requestAnimationFrame(() => {
      hideStartupSplash()
    })
  })
}
