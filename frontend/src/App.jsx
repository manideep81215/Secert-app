import { useEffect, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Client } from '@stomp/stompjs'
import SockJS from 'sockjs-client'
import { ToastContainer } from 'react-toastify'
import AuthPage from './pages/AuthPage'
import GamesPage from './pages/GamesPage'
import RpsGamePage from './pages/RpsGamePage'
import CoinGamePage from './pages/CoinGamePage'
import TttGamePage from './pages/TttGamePage'
import SnakeLadderGamePage from './pages/SnakeLadderGamePage'
import VerifyPage from './pages/VerifyPage'
import ChatPageNew from './pages/ChatPageNew'
import ChatInfoPage from './pages/ChatInfoPage'
import ProfilePage from './pages/ProfilePage'
import { WS_CHAT_URL } from './config/apiConfig'
import { resetFlowState, useFlowState } from './hooks/useFlowState'
import { refreshAccessToken } from './services/authApi'
import {
  clearActiveNotifications,
  ensureNotificationPermission as ensureLocalNotificationPermission,
  pushNotify,
  setNotifyCutoff,
} from './lib/notifications'
import {
  clearNativeDeliveredPushNotifications,
  clearNativePushRegistration,
  syncNativePushRegistration,
} from './lib/nativePush'
import { ensurePushSubscription } from './lib/pushSubscription'
import './App.css'

function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const [flow, setFlow] = useFlowState()
  const isAuthenticated = Boolean((flow?.username || '').trim() && (flow?.token || '').trim())
  const routeHistoryRef = useRef([])
  const isAuthenticatedRef = useRef(isAuthenticated)
  const currentPathRef = useRef(location.pathname)
  const previousTokenRef = useRef((flow?.token || '').trim())
  const [installPromptEvent, setInstallPromptEvent] = useState(null)
  const [isAppInstalled, setIsAppInstalled] = useState(false)
  const [showIosInstallHelp, setShowIosInstallHelp] = useState(false)
  const refreshTimerRef = useRef(null)
  const isFullBleedRoute =
    location.pathname === '/auth' ||
    location.pathname.startsWith('/games') ||
    location.pathname === '/profile' ||
    location.pathname === '/verify' ||
    location.pathname === '/users' ||
    location.pathname.startsWith('/chat')

  useEffect(() => {
    isAuthenticatedRef.current = isAuthenticated
  }, [isAuthenticated])

  useEffect(() => {
    if (refreshTimerRef.current) {
      window.clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = null
    }

    const accessToken = (flow?.token || '').trim()
    const refreshToken = (flow?.refreshToken || '').trim()
    if (!accessToken || !refreshToken) return undefined

    const decodeExpMs = (token) => {
      try {
        const [, payload] = token.split('.')
        if (!payload) return 0
        const json = JSON.parse(window.atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
        return Number(json?.exp || 0) * 1000
      } catch {
        return 0
      }
    }

    const refreshNow = async () => {
      try {
        const data = await refreshAccessToken(refreshToken)
        const nextAccess = (data?.token || '').trim()
        const nextRefresh = (data?.refreshToken || '').trim()
        if (!nextAccess || !nextRefresh) throw new Error('invalid-refresh-response')
        setFlow((prev) => ({
          ...prev,
          token: nextAccess,
          refreshToken: nextRefresh,
        }))
      } catch (error) {
        const status = Number(error?.response?.status || 0)
        // Logout only when refresh token is truly invalid/expired.
        if (status === 401 || status === 403) {
          resetFlowState(setFlow)
          return
        }
        // For transient network/server issues, keep session and retry soon.
        if (!refreshTimerRef.current) {
          refreshTimerRef.current = window.setTimeout(() => {
            refreshTimerRef.current = null
            refreshNow()
          }, 60 * 1000)
        }
      }
    }

    const expMs = decodeExpMs(accessToken)
    if (!expMs) return undefined

    const now = Date.now()
    const refreshLeadMs = 60 * 1000
    const delay = expMs - now - refreshLeadMs
    if (delay <= 0) {
      refreshNow()
      return undefined
    }

    refreshTimerRef.current = window.setTimeout(refreshNow, delay)
    return () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }
  }, [flow?.token, flow?.refreshToken, setFlow])

  useEffect(() => {
    currentPathRef.current = location.pathname
    const stack = routeHistoryRef.current
    if (!stack.length || stack[stack.length - 1] !== location.pathname) {
      stack.push(location.pathname)
    }
    if (stack.length > 40) {
      stack.splice(0, stack.length - 40)
    }
  }, [location.pathname])

  useEffect(() => {
    const authToken = (flow?.token || '').trim()
    const authUsername = (flow?.username || '').trim()
    if (!authToken || !authUsername) return undefined

    const shouldSuppressGlobalMessageNotification = (pathname) => {
      if (!pathname) return false
      if (pathname !== '/chat') return false
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') return false
      if (typeof window === 'undefined') return false
      const activeChatPeerKey = `active_chat_peer_v1:${authUsername.toLowerCase()}`
      const activeChatPeer = (window.localStorage.getItem(activeChatPeerKey) || '').trim()
      return Boolean(activeChatPeer)
    }

    const previewFromPayload = (payload) => {
      const type = payload?.type || 'text'
      if (type === 'image') return 'Sent an image'
      if (type === 'video') return 'Sent a video'
      if (type === 'voice') return 'Sent a voice message'
      if (type === 'file') return payload?.fileName ? `Sent file: ${payload.fileName}` : 'Sent a file'
      return payload?.message || 'New message'
    }

    const client = new Client({
      webSocketFactory: () => new SockJS(WS_CHAT_URL, null, {
        transports: ['websocket', 'xhr-streaming', 'xhr-polling'],
      }),
      connectHeaders: {
        username: authUsername,
        Authorization: `Bearer ${authToken}`,
      },
      reconnectDelay: 1000,
      heartbeatIncoming: 10000,
      heartbeatOutgoing: 10000,
      onConnect: () => {
        client.subscribe('/user/queue/messages', async (frame) => {
          try {
            const payload = JSON.parse(frame.body || '{}')
            const fromUsername = (payload?.fromUsername || '').trim()
            if (!fromUsername) return
            const currentPath = currentPathRef.current || ''
            if (shouldSuppressGlobalMessageNotification(currentPath)) return

            const preview = previewFromPayload(payload)
            await pushNotify(`@${fromUsername}`, preview)
            setNotifyCutoff(authUsername, fromUsername, Number(payload?.createdAt || Date.now()))
          } catch {
            // Ignore malformed realtime payloads.
          }
        })
      },
    })

    client.activate()
    return () => {
      client.deactivate()
    }
  }, [flow?.token, flow?.username])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const cap = window.Capacitor
    const isNative = typeof cap?.isNativePlatform === 'function'
      ? cap.isNativePlatform()
      : cap?.getPlatform?.() === 'android' || cap?.getPlatform?.() === 'ios'
    if (!isNative) return undefined

    let listenerHandle = null
    let disposed = false

    const setupBackHandler = async () => {
      try {
        const mod = await import('@capacitor/app')
        if (disposed) return
        listenerHandle = await mod.App.addListener('backButton', () => {
          const current = currentPathRef.current || ''
          const activeChatPeerKey = `active_chat_peer_v1:${(flow?.username || '').trim().toLowerCase()}`
          const activeChatPeer = typeof window !== 'undefined'
            ? (window.localStorage.getItem(activeChatPeerKey) || '').trim()
            : ''
          const orderedBackMap = {
            '/chat': '/users',
            '/users': '/profile',
            '/verify': '/profile',
            '/profile': '/games',
          }

          if (current === '/chat/info') {
            navigate('/chat', { replace: true })
            return
          }

          const mappedTarget = orderedBackMap[current]
          if (mappedTarget && current !== mappedTarget) {
            navigate(mappedTarget, { replace: true })
            return
          }

          const stack = routeHistoryRef.current
          if (stack.length > 1) {
            stack.pop()
            const previous = stack[stack.length - 1]
            if (previous && previous !== current) {
              navigate(previous, { replace: true })
              return
            }
          }

          const fallback = isAuthenticatedRef.current ? '/games' : '/auth'
          if (currentPathRef.current !== fallback) {
            navigate(fallback, { replace: true })
          }
        })
      } catch {
        // Ignore back-button listener setup failures.
      }
    }

    setupBackHandler()
    return () => {
      disposed = true
      listenerHandle?.remove?.()
    }
  }, [flow?.username, navigate])

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
    if (!flow?.token) return undefined

    const clearNow = () => {
      clearActiveNotifications().catch(() => {
        // Ignore notification cleanup failures.
      })
      clearNativeDeliveredPushNotifications().catch(() => {
        // Ignore native push tray cleanup failures.
      })
    }

    clearNow()

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        clearNow()
      }
    }

    window.addEventListener('focus', clearNow)
    window.addEventListener('pageshow', clearNow)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('focus', clearNow)
      window.removeEventListener('pageshow', clearNow)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [flow?.token])

  useEffect(() => {
    const currentToken = (flow?.token || '').trim()
    if (currentToken) {
      syncNativePushRegistration(currentToken).catch(() => {
        // Ignore mobile push registration failures.
      })
      previousTokenRef.current = currentToken
      return
    }

    const previousToken = (previousTokenRef.current || '').trim()
    if (!previousToken) return
    clearNativePushRegistration(previousToken).catch(() => {
      // Ignore mobile push cleanup failures.
    })
    previousTokenRef.current = ''
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
          <Route path="/" element={<Navigate to={isAuthenticated ? '/games' : '/auth'} replace />} />
          <Route path="/auth" element={isAuthenticated ? <Navigate to="/games" replace /> : <AuthPage />} />
          <Route path="/games" element={isAuthenticated ? <GamesPage /> : <Navigate to="/auth" replace />} />
          <Route path="/games/rps" element={isAuthenticated ? <RpsGamePage /> : <Navigate to="/auth" replace />} />
          <Route path="/games/coin" element={isAuthenticated ? <CoinGamePage /> : <Navigate to="/auth" replace />} />
          <Route path="/games/ttt" element={isAuthenticated ? <TttGamePage /> : <Navigate to="/auth" replace />} />
          <Route path="/games/snake-ladder" element={isAuthenticated ? <SnakeLadderGamePage /> : <Navigate to="/auth" replace />} />
          <Route path="/verify" element={isAuthenticated ? <VerifyPage /> : <Navigate to="/auth" replace />} />
          <Route path="/users" element={isAuthenticated ? <Navigate to="/chat" replace state={{ openUsersList: true }} /> : <Navigate to="/auth" replace />} />
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
        position="top-center"
        autoClose={1500}
        hideProgressBar
        limit={1}
        pauseOnFocusLoss={false}
      />
    </div>
  )
}

export default App
