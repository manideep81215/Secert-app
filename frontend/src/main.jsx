import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'react-toastify/dist/ReactToastify.css'
import './styles/base.css'
import App from './App.jsx'
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

if ('serviceWorker' in navigator) {
  if (isNativeCapacitorRuntime()) {
    // Avoid stale cached bundles in Capacitor WebView.
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister())
    }).catch(() => {
      // Ignore service worker cleanup failures in native runtime.
    })
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
      <App />
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
