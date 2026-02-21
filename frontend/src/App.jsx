import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ToastContainer } from 'react-toastify'
import AuthPage from './pages/AuthPage'
import GamesPage from './pages/GamesPage'
import RpsGamePage from './pages/RpsGamePage'
import CoinGamePage from './pages/CoinGamePage'
import TttGamePage from './pages/TttGamePage'
import VerifyPage from './pages/VerifyPage'
import UsersListPage from './pages/UsersListPage'
import ChatPageNew from './pages/ChatPageNew'
import ChatInfoPage from './pages/ChatInfoPage'
import ProfilePage from './pages/ProfilePage'
import { useFlowState } from './hooks/useFlowState'
import { ensureNotificationPermission as ensureLocalNotificationPermission } from './lib/notifications'
import { ensurePushSubscription } from './lib/pushSubscription'
import './App.css'

function App() {
  const location = useLocation()
  const [flow] = useFlowState()
  const isAuthenticated = Boolean((flow?.username || '').trim() && (flow?.token || '').trim())
  const [installPromptEvent, setInstallPromptEvent] = useState(null)
  const [isAppInstalled, setIsAppInstalled] = useState(false)
  const [showIosInstallHelp, setShowIosInstallHelp] = useState(false)
  const isFullBleedRoute =
    location.pathname === '/auth' ||
    location.pathname.startsWith('/games') ||
    location.pathname === '/profile' ||
    location.pathname === '/verify' ||
    location.pathname === '/users' ||
    location.pathname.startsWith('/chat')

  useEffect(() => {
    const IOS_HELP_DISMISSED_KEY = 'ios_install_help_dismissed'

    const isIosSafariBrowser = () => {
      const ua = window.navigator.userAgent.toLowerCase()
      const isIos = /iphone|ipad|ipod/.test(ua)
      const isWebKit = /safari/.test(ua)
      const isOtherIosBrowser = /crios|fxios|edgios|opios/.test(ua)
      return isIos && isWebKit && !isOtherIosBrowser
    }

    const checkInstalled = () => {
      const standalone = window.matchMedia?.('(display-mode: standalone)').matches
      const iosStandalone = window.navigator.standalone === true
      const installed = Boolean(standalone || iosStandalone)
      setIsAppInstalled(installed)

      const dismissed = window.localStorage.getItem(IOS_HELP_DISMISSED_KEY) === 'true'
      const shouldShowIosHelp = isIosSafariBrowser() && !installed && !dismissed
      setShowIosInstallHelp(shouldShowIosHelp)
    }

    const onBeforeInstallPrompt = (event) => {
      event.preventDefault()
      setInstallPromptEvent(event)
      checkInstalled()
    }

    const onAppInstalled = () => {
      setInstallPromptEvent(null)
      setIsAppInstalled(true)
    }

    checkInstalled()
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [])

  const handleInstall = async () => {
    if (!installPromptEvent) return
    installPromptEvent.prompt()
    const result = await installPromptEvent.userChoice
    if (result?.outcome !== 'accepted') return
    setInstallPromptEvent(null)
  }

  const dismissIosInstallHelp = () => {
    window.localStorage.setItem('ios_install_help_dismissed', 'true')
    setShowIosInstallHelp(false)
  }

  useEffect(() => {
    if (!flow?.token) return

    let disposed = false
    let inFlight = false

    const syncPushSubscription = async () => {
      if (disposed || inFlight) return
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
      inFlight = true
      try {
        await ensurePushSubscription(flow.token)
      } catch {
        // Ignore push subscription setup failures.
      } finally {
        inFlight = false
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncPushSubscription()
      }
    }
    const onSwMessage = (event) => {
      if (event?.data?.type === 'push-subscription-change') {
        syncPushSubscription()
      }
    }

    syncPushSubscription()
    window.addEventListener('focus', syncPushSubscription)
    window.addEventListener('online', syncPushSubscription)
    navigator.serviceWorker?.addEventListener?.('message', onSwMessage)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      disposed = true
      window.removeEventListener('focus', syncPushSubscription)
      window.removeEventListener('online', syncPushSubscription)
      navigator.serviceWorker?.removeEventListener?.('message', onSwMessage)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [flow?.token])

  useEffect(() => {
    if (!flow?.token) return
    const cap = typeof window !== 'undefined' ? window.Capacitor : null
    const isNative = typeof cap?.isNativePlatform === 'function'
      ? cap.isNativePlatform()
      : cap?.getPlatform?.() === 'android' || cap?.getPlatform?.() === 'ios'
    if (!isNative) return

    ensureLocalNotificationPermission(true).catch(() => {
      // Ignore runtime permission request failures.
    })
  }, [flow?.token])

  return (
    <div className={`app-wrap container-fluid ${isFullBleedRoute ? 'app-auth-route p-0' : 'py-4 px-3 px-md-4'}`}>
      <div className={isFullBleedRoute ? 'app-auth-max' : 'mx-auto app-max'}>
        <Routes>
          <Route path="/" element={<Navigate to="/auth" replace />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/games" element={isAuthenticated ? <GamesPage /> : <Navigate to="/auth" replace />} />
          <Route path="/games/rps" element={isAuthenticated ? <RpsGamePage /> : <Navigate to="/auth" replace />} />
          <Route path="/games/coin" element={isAuthenticated ? <CoinGamePage /> : <Navigate to="/auth" replace />} />
          <Route path="/games/ttt" element={isAuthenticated ? <TttGamePage /> : <Navigate to="/auth" replace />} />
          <Route path="/verify" element={isAuthenticated ? <VerifyPage /> : <Navigate to="/auth" replace />} />
          <Route path="/users" element={isAuthenticated ? <UsersListPage /> : <Navigate to="/auth" replace />} />
          <Route path="/chat" element={isAuthenticated ? <ChatPageNew /> : <Navigate to="/auth" replace />} />
          <Route path="/chat/info" element={isAuthenticated ? <ChatInfoPage /> : <Navigate to="/auth" replace />} />
          <Route path="/profile" element={isAuthenticated ? <ProfilePage /> : <Navigate to="/auth" replace />} />
          <Route path="*" element={<Navigate to="/auth" replace />} />
        </Routes>
      </div>

      {!isAppInstalled && installPromptEvent && (
        <button className="pwa-install-btn" onClick={handleInstall} aria-label="Install app">
          Install App
        </button>
      )}

      {!isAppInstalled && !installPromptEvent && showIosInstallHelp && (
        <div className="pwa-ios-help" role="status" aria-live="polite">
          <button
            className="pwa-ios-help-close"
            onClick={dismissIosInstallHelp}
            type="button"
            aria-label="Close iOS install instructions"
          >
            x
          </button>
          <p className="pwa-ios-help-title">Install on iPhone</p>
          <p className="pwa-ios-help-text">1. Tap Share in Safari.</p>
          <p className="pwa-ios-help-text">2. Tap Add to Home Screen.</p>
        </div>
      )}

      <ToastContainer
        position="bottom-left"
        autoClose={1500}
        hideProgressBar
        limit={1}
        pauseOnFocusLoss={false}
      />
    </div>
  )
}

export default App
