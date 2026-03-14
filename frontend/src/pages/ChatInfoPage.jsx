import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Client } from '@stomp/stompjs'
import SockJS from 'sockjs-client'
import { PushNotifications } from '@capacitor/push-notifications'
import { useLocation, useNavigate } from 'react-router-dom'
import BackIcon from '../components/BackIcon'
import {
  ensureNotificationPermission,
  getNotificationBlockedHelp,
  getNotificationPermissionState,
  setNotifyCutoff,
} from '../lib/notifications'
import { ensurePushSubscription } from '../lib/pushSubscription'
import { syncNativePushRegistration } from '../lib/nativePush'
import { getPushPublicKey, getPushStatus, sendTestPush, subscribeMobilePush } from '../services/pushApi'
import { useFlowState } from '../hooks/useFlowState'
import { WS_CHAT_URL } from '../config/apiConfig'
import { getConversation } from '../services/messagesApi'
import './ChatInfoPage.css'

const notify = { success: () => {}, error: () => {}, info: () => {}, warn: () => {} }

const CLEAR_CUTOFFS_KEY = 'chat_clear_cutoffs_v1'
const INFO_MEDIA_PAGE_SIZE = 50
const INFO_MEDIA_PAGE_LIMIT = 120
const MOBILE_PUSH_TOKEN_KEY = 'mobile_push_token_v1'

function ChatInfoPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [flow] = useFlowState()

  const selectedUser = location.state?.selectedUser || null
  const selectedPresence = location.state?.selectedPresence || { status: 'offline', lastSeenAt: null }
  const selectedTyping = Boolean(location.state?.selectedTyping)
  const selectedSeen = Boolean(location.state?.selectedSeen)
  const seededMediaItems = useMemo(() => {
    const rows = location.state?.mediaItems
    return Array.isArray(rows) ? rows.filter((row) => row?.mediaUrl) : []
  }, [location.state?.mediaItems])
  const seededFileItems = useMemo(() => {
    const rows = location.state?.fileItems
    return Array.isArray(rows) ? rows.filter((row) => row?.mediaUrl) : []
  }, [location.state?.fileItems])
  const [mediaItems, setMediaItems] = useState(seededMediaItems)
  const [fileItems, setFileItems] = useState(seededFileItems)
  const [isMediaLoading, setIsMediaLoading] = useState(false)
  const [mediaLoadError, setMediaLoadError] = useState('')

  const [notificationPermission, setNotificationPermission] = useState(
    () => location.state?.notificationPermission || getNotificationPermissionState()
  )
  const [showPushDebug, setShowPushDebug] = useState(false)
  const [videoThumbMap, setVideoThumbMap] = useState({})
  const [pushDebug, setPushDebug] = useState({
    loading: false,
    notificationPermission: getNotificationPermissionState(),
    serviceWorkerActive: false,
    subscriptionExists: false,
    pushKeyRegistered: false,
    pushServerEnabled: false,
    lastSyncAt: null,
    error: '',
    hint: '',
  })
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [activeMediaPreview, setActiveMediaPreview] = useState(null)
  const cap = typeof window !== 'undefined' ? window.Capacitor : null
  const nativePlatform = typeof cap?.getPlatform === 'function' ? cap.getPlatform() : null
  const isNativeRuntime = typeof cap?.isNativePlatform === 'function'
    ? cap.isNativePlatform()
    : nativePlatform === 'android' || nativePlatform === 'ios'
  const isNativeAndroid = typeof cap?.isNativePlatform === 'function'
    ? cap.isNativePlatform() && nativePlatform === 'android'
    : nativePlatform === 'android'
  useEffect(() => {
    if ((flow?.role || 'game') !== 'chat') {
      navigate('/games', { replace: true })
      return
    }
    if (selectedUser?.username) return
    navigate('/chat', { replace: true })
  }, [flow?.role, navigate, selectedUser?.username])

  useEffect(() => {
    setMediaItems(seededMediaItems)
  }, [seededMediaItems])

  useEffect(() => {
    setFileItems(seededFileItems)
  }, [seededFileItems])

  useEffect(() => {
    let cancelled = false

    const normalizeMediaItem = (row) => {
      const type = String(row?.type || '').toLowerCase()
      if (type !== 'image' && type !== 'video') return null
      const mediaUrl = String(row?.mediaUrl || '').trim()
      if (!mediaUrl) return null
      const createdAtRaw = row?.createdAt || row?.clientCreatedAt || row?.timestamp || null
      const parsedCreatedAt = Number(createdAtRaw)
      const createdAt = Number.isFinite(parsedCreatedAt) && parsedCreatedAt > 0
        ? parsedCreatedAt
        : Date.parse(createdAtRaw || '') || 0
      return {
        messageId: row?.messageId || row?.id || null,
        type,
        mediaUrl,
        fileName: row?.fileName || null,
        createdAt,
      }
    }

    const normalizeFileItem = (row) => {
      const type = String(row?.type || '').toLowerCase()
      if (type !== 'file') return null
      const mediaUrl = String(row?.mediaUrl || '').trim()
      if (!mediaUrl) return null
      const createdAtRaw = row?.createdAt || row?.clientCreatedAt || row?.timestamp || null
      const parsedCreatedAt = Number(createdAtRaw)
      const createdAt = Number.isFinite(parsedCreatedAt) && parsedCreatedAt > 0
        ? parsedCreatedAt
        : Date.parse(createdAtRaw || '') || 0
      return {
        messageId: row?.messageId || row?.id || null,
        mediaUrl,
        fileName: row?.fileName || 'attachment',
        mimeType: row?.mimeType || null,
        createdAt,
      }
    }

    const buildDedupeKey = (item) => {
      if (item?.messageId) return `id:${item.messageId}`
      return `url:${item?.mediaUrl || ''}|type:${item?.type || ''}|name:${item?.fileName || ''}|time:${item?.createdAt || 0}`
    }

    const loadFullMediaHistory = async () => {
      if (!selectedUser?.username || !flow?.token) return
      setIsMediaLoading(true)
      setMediaLoadError('')

      try {
        const collectedMedia = new Map()
        const collectedFiles = new Map()
        seededMediaItems.forEach((row) => {
          const normalized = normalizeMediaItem(row)
          if (!normalized) return
          collectedMedia.set(buildDedupeKey(normalized), normalized)
        })
        seededFileItems.forEach((row) => {
          const normalized = normalizeFileItem(row)
          if (!normalized) return
          collectedFiles.set(buildDedupeKey(normalized), normalized)
        })

        for (let page = 0; page < INFO_MEDIA_PAGE_LIMIT; page += 1) {
          if (cancelled) return
          const result = await getConversation(flow.token, selectedUser.username, {
            page,
            size: INFO_MEDIA_PAGE_SIZE,
          })
          const rows = Array.isArray(result?.messages) ? result.messages : []
          rows.forEach((row) => {
            const normalizedMedia = normalizeMediaItem(row)
            if (normalizedMedia) {
              collectedMedia.set(buildDedupeKey(normalizedMedia), normalizedMedia)
            }
            const normalizedFile = normalizeFileItem(row)
            if (normalizedFile) {
              collectedFiles.set(buildDedupeKey(normalizedFile), normalizedFile)
            }
          })

          const hasMore = Boolean(result?.hasMore)
          if (!hasMore || rows.length < INFO_MEDIA_PAGE_SIZE) break
        }

        if (cancelled) return
        const mergedMedia = [...collectedMedia.values()]
        mergedMedia.sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))
        setMediaItems(mergedMedia)
        const mergedFiles = [...collectedFiles.values()]
        mergedFiles.sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))
        setFileItems(mergedFiles)
      } catch {
        if (!cancelled) {
          setMediaLoadError('Could not load complete chat assets. Showing available data only.')
        }
      } finally {
        if (!cancelled) setIsMediaLoading(false)
      }
    }

    void loadFullMediaHistory()

    return () => {
      cancelled = true
    }
  }, [flow?.token, seededFileItems, seededMediaItems, selectedUser?.username])

  const triggerFileDownload = (url, fileName) => {
    const downloadUrl = String(url || '').trim()
    if (!downloadUrl) return
    const anchor = document.createElement('a')
    anchor.href = downloadUrl
    anchor.download = fileName || 'attachment'
    anchor.target = '_blank'
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }

  const formatUsername = (name) => {
    const raw = (name || '').trim().replace(/^@+/, '')
    return raw || 'Unknown'
  }

  const getUserDisplayName = (user) => {
    const name = (user?.name || '').trim()
    if (name) return name
    return formatUsername(user?.username)
  }

  const getAvatarLabel = (name) => {
    const normalized = formatUsername(name)
    if (normalized === 'Unknown') return '?'
    if (normalized.length === 1) return normalized.toUpperCase()
    return `${normalized[0]}${normalized[normalized.length - 1]}`.toUpperCase()
  }

  const toLongLastSeen = (lastSeenAt) => {
    const timestamp = Number(lastSeenAt || 0)
    if (!timestamp) return 'last online unavailable'
    const formatted = new Date(timestamp).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).toLowerCase()
    return `last online at ${formatted}`
  }

  const statusLabel = selectedTyping
    ? 'typing...'
    : (selectedPresence.status === 'online'
        ? `${selectedSeen ? 'Seen · ' : ''}online`
        : `${selectedSeen ? 'Seen · ' : ''}${toLongLastSeen(selectedPresence.lastSeenAt)}`)

  const goBackToChat = () => {
    navigate('/chat', {
      replace: true,
      state: {
        selectedUserId: selectedUser?.id || null,
        selectedUsername: selectedUser?.username,
      },
    })
  }

  const openFullRecap = () => {
    if (!selectedUser?.username) return
    navigate(`/chat/recap?peer=${encodeURIComponent(selectedUser.username)}`, {
      state: { peerUsername: selectedUser.username },
    })
  }

  const requestNotificationAccess = async () => {
    const granted = await ensureNotificationPermission(true)
    const current = granted ? 'granted' : getNotificationPermissionState()
    setNotificationPermission(current)
    if (granted) {
      if (isNativeRuntime && flow?.token) {
        const nativeRegistered = await syncNativePushRegistration(flow.token)
        if (!nativeRegistered) {
          notify.warn('Permission granted, but native push token is not ready yet.')
        } else {
          notify.success('Notifications enabled.')
        }
      } else {
        notify.success('Notifications enabled.')
      }
      if (!isNativeRuntime && flow?.token) {
        try {
          const keyConfig = await getPushPublicKey()
          const pushEnabled = Boolean(keyConfig?.enabled && keyConfig?.publicKey)
          if (pushEnabled) {
            await ensurePushSubscription(flow.token)
          }
        } catch {
          // Ignore key-check failures during permission request.
        }
      }
      refreshPushDebug('permission')
      return
    }
    if (current === 'denied') {
      notify.error(getNotificationBlockedHelp(), { autoClose: 5500 })
    } else {
      notify.error('Notification permission not granted.')
    }
  }

  const refreshPushDebug = async (reason = 'manual') => {
    if (typeof window === 'undefined') return
    const snapshot = {
      loading: true,
      notificationPermission: getNotificationPermissionState(),
      serviceWorkerActive: false,
      subscriptionExists: false,
      pushKeyRegistered: false,
      pushServerEnabled: false,
      lastSyncAt: pushDebug.lastSyncAt,
      error: '',
      hint: '',
    }
    setPushDebug(snapshot)

    if (isNativeRuntime) {
      try {
        let nativePermission = snapshot.notificationPermission
        try {
          const permission = await PushNotifications.checkPermissions()
          nativePermission = permission?.receive || nativePermission
        } catch {
          // Ignore native permission check failures.
        }

        let registrationError = ''
        if (flow?.token && nativePermission === 'granted') {
          const registered = await syncNativePushRegistration(flow.token)
          if (!registered) {
            registrationError = 'Native push registration failed.'
          }
        }

        let nativeToken = ''
        try {
          nativeToken = (window.localStorage.getItem(MOBILE_PUSH_TOKEN_KEY) || '').trim()
        } catch {
          nativeToken = ''
        }

        let pushServerEnabled = false
        let pushKeyRegistered = false
        let keyError = ''
        let keyHint = ''
        let serverMobileTokens = 0
        let statusSupported = false
        let tokenSyncError = ''
        try {
          const keyConfig = await getPushPublicKey()
          pushServerEnabled = Boolean(keyConfig?.nativeEnabled ?? keyConfig?.enabled)
          pushKeyRegistered = pushServerEnabled
          if (!pushServerEnabled) {
            keyHint = 'Server-side mobile push is disabled.'
          }
        } catch (error) {
          keyError = error?.message || 'Push server check failed.'
        }

        if (flow?.token && nativePermission === 'granted' && nativeToken) {
          try {
            await subscribeMobilePush(flow.token, {
              token: nativeToken,
              platform: nativePlatform || 'android',
            })
          } catch (error) {
            tokenSyncError = error?.message || 'Token sync failed.'
          }
        }

        if (flow?.token) {
          try {
            const status = await getPushStatus(flow.token)
            statusSupported = true
            serverMobileTokens = Number(status?.mobileTokens || 0)
            if (!pushServerEnabled) {
              pushServerEnabled = Boolean(status?.nativePushEnabled)
            }
          } catch (error) {
            const statusCode = Number(error?.response?.status || 0)
            if (statusCode !== 404 && !keyError) {
              keyError = error?.message || 'Push status check failed.'
            }
          }
        }

        const hasLocalToken = Boolean(nativeToken)
        const hasServerToken = serverMobileTokens > 0
        const subscriptionExists = statusSupported ? (hasLocalToken && hasServerToken) : hasLocalToken

        if (!keyHint && nativePermission === 'granted' && !hasLocalToken) {
          keyHint = 'Device token not ready yet. Tap Notify again after a moment.'
        } else if (!keyHint && statusSupported && hasLocalToken && !hasServerToken) {
          keyHint = 'Token exists on device but not on server yet. Keep app online and tap Refresh.'
        } else if (!keyHint && !statusSupported && hasLocalToken) {
          keyHint = 'Device token is ready. Status endpoint is unavailable on this backend version.'
        }

        const combinedError = [registrationError, tokenSyncError, keyError].filter(Boolean).join(' ')
        const next = {
          loading: false,
          notificationPermission: nativePermission,
          serviceWorkerActive: true,
          subscriptionExists,
          pushKeyRegistered,
          pushServerEnabled,
          lastSyncAt: Date.now(),
          error: combinedError,
          hint: keyHint,
        }
        setPushDebug(next)
        console.info('[push-debug]', { reason, mode: 'native', ...next })
      } catch (error) {
        const next = {
          loading: false,
          notificationPermission: snapshot.notificationPermission,
          serviceWorkerActive: false,
          subscriptionExists: false,
          pushKeyRegistered: false,
          pushServerEnabled: false,
          lastSyncAt: Date.now(),
          error: error?.message || 'Native push debug check failed.',
          hint: '',
        }
        setPushDebug(next)
        console.warn('[push-debug]', { reason, mode: 'native', ...next })
      }
      return
    }

    try {
      let registration = null
      if ('serviceWorker' in navigator) {
        registration = await navigator.serviceWorker.getRegistration('/sw.js')
        if (!registration) {
          registration = await Promise.race([
            navigator.serviceWorker.ready,
            new Promise((resolve) => window.setTimeout(() => resolve(null), 1800)),
          ])
        }
      }

      const serviceWorkerActive = Boolean(registration?.active)

      let subscriptionError = ''
      if (flow?.token && snapshot.notificationPermission === 'granted') {
        try {
          await ensurePushSubscription(flow.token)
        } catch (error) {
          subscriptionError = error?.message || 'Subscription setup failed.'
        }
      }

      if (!registration && 'serviceWorker' in navigator) {
        registration = await navigator.serviceWorker.getRegistration('/sw.js')
      }
      const subscription = registration?.pushManager ? await registration.pushManager.getSubscription() : null
      const subscriptionExists = Boolean(subscription)

      let pushKeyRegistered = false
      let pushServerEnabled = false
      let keyError = ''
      let keyHint = ''
      try {
        const keyConfig = await getPushPublicKey()
        pushServerEnabled = Boolean(keyConfig?.enabled)
        pushKeyRegistered = Boolean(keyConfig?.enabled && keyConfig?.publicKey)
        if (!pushKeyRegistered) {
          keyHint = 'Server push key is missing. Foreground notifications still work.'
        }
      } catch (error) {
        keyError = error?.message || 'Push key check failed.'
      }

      const combinedError = [subscriptionError, keyError].filter(Boolean).join(' ')
      const next = {
        loading: false,
        notificationPermission: snapshot.notificationPermission,
        serviceWorkerActive,
        subscriptionExists,
        pushKeyRegistered,
        pushServerEnabled,
        lastSyncAt: Date.now(),
        error: combinedError,
        hint: keyHint,
      }
      setPushDebug(next)
      console.info('[push-debug]', { reason, ...next })
    } catch (error) {
      const next = {
        loading: false,
        notificationPermission: snapshot.notificationPermission,
        serviceWorkerActive: snapshot.serviceWorkerActive,
        subscriptionExists: snapshot.subscriptionExists,
        pushKeyRegistered: snapshot.pushKeyRegistered,
        pushServerEnabled: snapshot.pushServerEnabled,
        lastSyncAt: Date.now(),
        error: error?.message || 'Push debug check failed.',
        hint: '',
      }
      setPushDebug(next)
      console.warn('[push-debug]', { reason, ...next })
    }
  }

  const handleSendTestPush = async () => {
    if (!flow?.token) {
      notify.error('Login required for test push.')
      return
    }
    try {
      const result = await sendTestPush(flow.token, {})
      if (result?.success) {
        const sent = Number(result?.sent || 0)
        const attempted = Number(result?.attempted || 0)
        const suffix = attempted > 0 ? ` (${sent}/${attempted})` : ''
        notify.success((result?.message || 'Test push sent.') + suffix)
      } else {
        const sent = Number(result?.sent || 0)
        const attempted = Number(result?.attempted || 0)
        const suffix = attempted > 0 ? ` (${sent}/${attempted})` : ''
        notify.error((result?.message || 'Test push failed.') + suffix)
      }
      refreshPushDebug('test-push')
    } catch (error) {
      const message = error?.response?.data?.message || error?.response?.data?.detail || 'Failed to send test push.'
      notify.error(message)
    }
  }

  const handleDeleteChatForMe = () => {
    if (!selectedUser?.username) {
      return
    }
    if (!flow?.username) {
      return
    }
    const key = `${(flow.username || '').toLowerCase()}::${(selectedUser.username || '').toLowerCase()}`
    let current = {}
    try {
      const raw = window.localStorage.getItem(CLEAR_CUTOFFS_KEY)
      const parsed = raw ? JSON.parse(raw) : {}
      current = parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      current = {}
    }
    const cutoffAt = Date.now()
    const next = { ...current, [key]: cutoffAt }
    try {
      window.localStorage.setItem(CLEAR_CUTOFFS_KEY, JSON.stringify(next))
    } catch {
      // Ignore localStorage failures.
    }
    setShowDeleteConfirm(false)
    navigate('/chat', {
      replace: true,
      state: {
        selectedUsername: selectedUser.username,
        refreshConversation: true,
        clearForUsername: selectedUser.username,
        clearCutoffAt: cutoffAt,
      },
    })
  }

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const videoUrls = [...new Set(
      mediaItems
        .filter((item) => item?.type === 'video' && item?.mediaUrl)
        .map((item) => String(item.mediaUrl || '').trim())
        .filter(Boolean)
    )]
    if (!videoUrls.length) return undefined
    const candidateUrls = videoUrls.slice(-40)
    const batchSize = isNativeRuntime ? 1 : 4
    const pendingUrls = candidateUrls.filter((url) => videoThumbMap[url] === undefined).slice(0, batchSize)
    if (!pendingUrls.length) return undefined

    let cancelled = false

    const generateThumb = (url) => new Promise((resolve) => {
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.preload = 'metadata'
      video.crossOrigin = 'anonymous'
      video.src = url

      const cleanup = () => {
        video.pause()
        video.removeAttribute('src')
        video.load()
      }

      const fail = () => {
        cleanup()
        resolve(null)
      }

      const capture = () => {
        try {
          const width = video.videoWidth || 0
          const height = video.videoHeight || 0
          if (!width || !height) return fail()
          const maxEdge = 300
          const scale = Math.min(1, maxEdge / Math.max(width, height))
          const targetWidth = Math.max(1, Math.round(width * scale))
          const targetHeight = Math.max(1, Math.round(height * scale))
          const canvas = document.createElement('canvas')
          canvas.width = targetWidth
          canvas.height = targetHeight
          const ctx = canvas.getContext('2d')
          if (!ctx) return fail()
          ctx.drawImage(video, 0, 0, targetWidth, targetHeight)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.72)
          cleanup()
          resolve(dataUrl || null)
        } catch {
          fail()
        }
      }

      video.addEventListener('loadedmetadata', () => {
        try {
          const targetTime = Math.min(0.4, Math.max((video.duration || 0) * 0.1, 0.05))
          if (Number.isFinite(targetTime) && targetTime > 0) {
            video.currentTime = targetTime
          } else {
            capture()
          }
        } catch {
          capture()
        }
      }, { once: true })
      video.addEventListener('seeked', capture, { once: true })
      video.addEventListener('error', fail, { once: true })
      setTimeout(fail, 8000)
    })

    const loadThumbs = async () => {
      for (const url of pendingUrls) {
        if (cancelled) return
        const thumb = await generateThumb(url)
        if (cancelled) return
        setVideoThumbMap((prev) => {
          if (prev[url] !== undefined) return prev
          return { ...prev, [url]: thumb }
        })
        if (isNativeRuntime) {
          await new Promise((resolve) => setTimeout(resolve, 140))
        }
      }
    }

    const timeoutId = window.setTimeout(() => { loadThumbs() }, isNativeRuntime ? 220 : 80)
    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [mediaItems, videoThumbMap, isNativeRuntime])

  useEffect(() => {
    const syncPermission = () => setNotificationPermission(getNotificationPermissionState())
    window.addEventListener('focus', syncPermission)
    document.addEventListener('visibilitychange', syncPermission)
    return () => {
      window.removeEventListener('focus', syncPermission)
      document.removeEventListener('visibilitychange', syncPermission)
    }
  }, [])

  useEffect(() => {
    refreshPushDebug('mount')
    const onFocus = () => refreshPushDebug('focus')
    const onOnline = () => refreshPushDebug('online')
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      refreshPushDebug('visible')
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [flow?.token, notificationPermission])

  useEffect(() => {
    const authToken = (flow.token || '').trim()
    const authUsername = (flow.username || '').trim()
    if (!authUsername || !authToken) return

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
        client.subscribe('/user/queue/messages', (frame) => {
          try {
            const payload = JSON.parse(frame.body)
            const fromUsername = (payload?.fromUsername || '').trim()
            if (!fromUsername) return

            setNotifyCutoff(authUsername, fromUsername, Number(payload?.createdAt || Date.now()))
          } catch {
            // Ignore malformed realtime payload.
          }
        })
      },
    })

    client.activate()
    return () => client.deactivate()
  }, [flow.username, flow.token])

  if (!selectedUser) {
    return null
  }

  return (
    <div className={`chat-info-page ${isNativeAndroid ? 'native-android' : ''}`}>
      <div className="chat-info-header">
        <button type="button" className="chat-info-back" onClick={goBackToChat} aria-label="Back to chat"><BackIcon /></button>
        <h2>User Details</h2>
      </div>

      <div className="chat-info-body">
        <div className="chat-info-avatar">{getAvatarLabel(getUserDisplayName(selectedUser))}</div>
        <h3 className="chat-info-name">{getUserDisplayName(selectedUser)}</h3>
        <p className="chat-info-status">{statusLabel}</p>

        <div className="chat-info-actions">
          <button type="button" className="chat-info-action" onClick={() => setShowDeleteConfirm(true)} aria-label="Delete chat">
            <span className="chat-info-action-icon">🗑</span>
            <span className="chat-info-action-label">Delete</span>
          </button>
          <button type="button" className={`chat-info-action ${notificationPermission === 'granted' ? 'active' : ''}`} onClick={requestNotificationAccess} aria-label="Enable notifications">
            <span className="chat-info-action-icon">🔔</span>
            <span className="chat-info-action-label">Notify</span>
          </button>
          <button type="button" className={`chat-info-action ${showPushDebug ? 'active' : ''}`} onClick={() => setShowPushDebug((prev) => !prev)} aria-label="Toggle debug panel">
            <span className="chat-info-action-icon chat-info-action-icon-debug" aria-hidden="true" />
            <span className="chat-info-action-label">Debug</span>
          </button>
          <button type="button" className="chat-info-action" onClick={goBackToChat} aria-label="Back to chat">
            <span className="chat-info-action-icon"><BackIcon size={15} /></span>
            <span className="chat-info-action-label">Back</span>
          </button>
        </div>

        <button type="button" className="chat-info-recap-button" onClick={openFullRecap}>
          View Full Recap
        </button>

        {showPushDebug && (
          <div className="push-debug-panel info-push-debug-panel">
            <div className="push-debug-head">
              <strong>Push Debug</strong>
              <div>
                <button type="button" onClick={handleSendTestPush} aria-label="Send test push">Send Test</button>
                <button type="button" onClick={() => refreshPushDebug('manual')} aria-label="Refresh push debug">Refresh</button>
              </div>
            </div>
            <div className="push-debug-row"><span>Permission</span><b>{pushDebug.notificationPermission}</b></div>
            <div className="push-debug-row"><span>SW Active</span><b>{pushDebug.serviceWorkerActive ? 'yes' : 'no'}</b></div>
            <div className="push-debug-row"><span>Subscription</span><b>{pushDebug.subscriptionExists ? 'yes' : 'no'}</b></div>
            <div className="push-debug-row"><span>Push Enabled</span><b>{pushDebug.pushServerEnabled ? 'yes' : 'no'}</b></div>
            <div className="push-debug-row"><span>Push Key</span><b>{pushDebug.pushKeyRegistered ? 'yes' : 'no'}</b></div>
            <div className="push-debug-row">
              <span>Last Sync</span>
              <b>{pushDebug.lastSyncAt ? new Date(pushDebug.lastSyncAt).toLocaleTimeString() : '-'}</b>
            </div>
            {pushDebug.loading && <div className="push-debug-state">checking...</div>}
            {pushDebug.error && <div className="push-debug-error">{pushDebug.error}</div>}
            {pushDebug.hint && <div className="push-debug-state">{pushDebug.hint}</div>}
          </div>
        )}

        <div className="chat-info-section">
          <h4>Contact Information</h4>
          <div className="chat-info-item">
            <span className="chat-info-label">Name</span>
            <span className="chat-info-value">{getUserDisplayName(selectedUser)}</span>
          </div>
          <div className="chat-info-item">
            <span className="chat-info-label">Username</span>
            <span className="chat-info-value">@{formatUsername(selectedUser.username)}</span>
          </div>
        </div>

        <div className="chat-info-section">
          <h4>Media</h4>
          {isMediaLoading && (
            <p className="chat-info-empty">Loading media/files history...</p>
          )}
          {mediaLoadError && (
            <p className="chat-info-empty">{mediaLoadError}</p>
          )}
          <div className="chat-info-media-grid">
            {mediaItems.map((msg, idx) => {
              const thumb = msg.type === 'video' ? videoThumbMap[String(msg.mediaUrl || '').trim()] : null
              return (
              <button
                key={`${msg.mediaUrl || idx}-${idx}`}
                type="button"
                className="chat-info-media-item"
                title={msg.fileName || (msg.type === 'image' ? 'Image' : 'Video')}
                onClick={() => setActiveMediaPreview({
                  type: msg.type === 'video' ? 'video' : 'image',
                  url: msg.mediaUrl,
                  name: msg.fileName || (msg.type === 'video' ? 'video' : 'image'),
                })}
              >
                {msg.type === 'image' ? (
                  <img className="chat-info-media-thumb" src={msg.mediaUrl} alt={msg.fileName || 'image'} loading="lazy" />
                ) : thumb ? (
                  <img className="chat-info-media-thumb" src={thumb} alt={msg.fileName || 'video thumbnail'} loading="lazy" />
                ) : (
                  <video className="chat-info-media-thumb chat-info-video-thumb" src={msg.mediaUrl} preload="metadata" muted playsInline />
                )}
                <span className="chat-info-media-badge">{msg.type === 'video' ? 'Video' : 'Image'}</span>
              </button>
              )
            })}
          </div>
          {mediaItems.length === 0 && (
            <p className="chat-info-empty">No media shared yet.</p>
          )}
        </div>

        <div className="chat-info-section">
          <h4>Files</h4>
          <div className="chat-info-files-list">
            {fileItems.map((item, idx) => (
              <button
                key={`${item.messageId || item.mediaUrl || idx}-${idx}`}
                type="button"
                className="chat-info-file-item"
                onClick={() => triggerFileDownload(item.mediaUrl, item.fileName || 'attachment')}
                title={item.fileName || 'Download file'}
              >
                <span className="chat-info-file-name">{item.fileName || 'attachment'}</span>
                <span className="chat-info-file-action">Download</span>
              </button>
            ))}
          </div>
          {fileItems.length === 0 && (
            <p className="chat-info-empty">No files shared yet.</p>
          )}
        </div>
      </div>

      <AnimatePresence>
        {activeMediaPreview && (
          <motion.div className="image-preview-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="image-preview-backdrop" onClick={() => setActiveMediaPreview(null)} />
            <motion.div className="image-preview-sheet media-preview-sheet" initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 16, opacity: 0 }}>
              <div className="image-preview-title">{activeMediaPreview.type === 'video' ? 'Preview video' : 'Preview image'}</div>
              {activeMediaPreview.type === 'video' ? (
                <video className="media-preview-video" src={activeMediaPreview.url} controls autoPlay playsInline />
              ) : (
                <img src={activeMediaPreview.url} alt={activeMediaPreview.name} className="image-preview-full" />
              )}
              <div className="image-preview-actions">
                <a href={activeMediaPreview.url} download={activeMediaPreview.name || (activeMediaPreview.type === 'video' ? 'video' : 'image')} className="image-preview-send">
                  Download
                </a>
                <button type="button" className="image-preview-cancel" onClick={() => setActiveMediaPreview(null)}>Close</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div className="confirm-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="confirm-modal-backdrop" onClick={() => setShowDeleteConfirm(false)} />
            <motion.div className="confirm-modal-card" initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 16, opacity: 0 }}>
              <div className="confirm-modal-title">Delete chat?</div>
              <div className="confirm-modal-text">Delete chat with {getUserDisplayName(selectedUser)} for you only?</div>
              <div className="confirm-modal-actions">
                <button type="button" className="confirm-cancel" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
                <button type="button" className="confirm-danger" onClick={handleDeleteChatForMe}>Delete</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default ChatInfoPage

