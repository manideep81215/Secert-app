import { useEffect, useMemo, useRef, useState } from 'react'
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
import { syncNativePushRegistration } from '../lib/nativePush'
import { getPushPublicKey, getPushStatus, sendTestPush, subscribeMobilePush } from '../services/pushApi'
import { useFlowState } from '../hooks/useFlowState'
import { API_BASE_URL, WS_CHAT_URL } from '../config/apiConfig'
import { getConversation } from '../services/messagesApi'
import './ChatInfoPage.css'

const notify = { success: () => {}, error: () => {}, info: () => {}, warn: () => {} }

const CLEAR_CUTOFFS_KEY = 'chat_clear_cutoffs_v1'
const INFO_MEDIA_PAGE_SIZE = 50
const INFO_MEDIA_PAGE_LIMIT = 120
const MOBILE_PUSH_TOKEN_KEY = 'mobile_push_token_v1'
const INFO_MEDIA_HISTORY_CACHE_TTL_MS = 30 * 1000
const infoMediaHistoryCache = new Map()
const infoMediaHistoryInFlight = new Map()

function toConversationKeyPart(value) {
  return String(value || '').trim().toLowerCase()
}

function readCachedInfoMediaHistory(conversationKey) {
  if (!conversationKey) return null
  const cached = infoMediaHistoryCache.get(conversationKey)
  if (!cached) return null
  if ((Date.now() - Number(cached.cachedAt || 0)) > INFO_MEDIA_HISTORY_CACHE_TTL_MS) {
    infoMediaHistoryCache.delete(conversationKey)
    return null
  }
  return cached.data || null
}

function normalizeMediaUrl(url) {
  const raw = String(url || '').trim()
  if (!raw) return ''
  if (/^(blob:|data:|content:|file:)/i.test(raw)) return raw
  if (raw.startsWith('/')) return `${API_BASE_URL}${raw}`
  if (/^https?:\/\/localhost:8080/i.test(raw)) {
    return `${API_BASE_URL}${raw.replace(/^https?:\/\/localhost:8080/i, '')}`
  }
  if (/^https?:\/\/127\.0\.0\.1:8080/i.test(raw)) {
    return `${API_BASE_URL}${raw.replace(/^https?:\/\/127\.0\.0\.1:8080/i, '')}`
  }
  if (!/^https?:\/\//i.test(raw) && API_BASE_URL) {
    return `${API_BASE_URL}/${raw.replace(/^\/+/, '')}`
  }
  return raw
}

function getInfoItemCreatedAt(row) {
  const createdAtRaw = row?.createdAt || row?.clientCreatedAt || row?.timestamp || null
  const parsedCreatedAt = Number(createdAtRaw)
  return Number.isFinite(parsedCreatedAt) && parsedCreatedAt > 0
    ? parsedCreatedAt
    : Date.parse(createdAtRaw || '') || 0
}

function normalizeInfoMediaItem(row) {
  const type = String(row?.type || '').toLowerCase()
  if (type !== 'image' && type !== 'video') return null
  const mediaUrl = normalizeMediaUrl(row?.mediaUrl || '')
  if (!mediaUrl) return null
  return {
    messageId: row?.messageId || row?.id || null,
    type,
    mediaUrl,
    fileName: row?.fileName || null,
    createdAt: getInfoItemCreatedAt(row),
  }
}

function normalizeInfoFileItem(row) {
  const type = String(row?.type || '').toLowerCase()
  if (type !== 'file') return null
  const mediaUrl = normalizeMediaUrl(row?.mediaUrl || '')
  if (!mediaUrl) return null
  return {
    messageId: row?.messageId || row?.id || null,
    mediaUrl,
    fileName: row?.fileName || 'attachment',
    mimeType: row?.mimeType || null,
    createdAt: getInfoItemCreatedAt(row),
  }
}

function buildInfoMediaDedupeKey(item) {
  const mediaUrl = String(item?.mediaUrl || '').trim()
  const type = String(item?.type || 'file').trim().toLowerCase()
  const createdAt = Number(item?.createdAt || 0)
  if (mediaUrl && createdAt > 0) {
    return `url:${mediaUrl}|type:${type}|time:${createdAt}`
  }
  if (item?.messageId) return `id:${item.messageId}`
  return `url:${mediaUrl}|type:${type}|name:${String(item?.fileName || '').trim()}`
}

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
    return Array.isArray(rows) ? rows.map((row) => normalizeInfoMediaItem(row)).filter(Boolean) : []
  }, [location.state?.mediaItems])
  const seededFileItems = useMemo(() => {
    const rows = location.state?.fileItems
    return Array.isArray(rows) ? rows.map((row) => normalizeInfoFileItem(row)).filter(Boolean) : []
  }, [location.state?.fileItems])
  const [mediaItems, setMediaItems] = useState(seededMediaItems)
  const [fileItems, setFileItems] = useState(seededFileItems)
  const [isMediaLoading, setIsMediaLoading] = useState(false)
  const [mediaLoadError, setMediaLoadError] = useState('')
  const [resolvedMediaUrlMap, setResolvedMediaUrlMap] = useState({})

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
  const resolvedMediaUrlRef = useRef({})
  const mediaFetchPromiseRef = useRef({})
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
    return () => {
      Object.values(resolvedMediaUrlRef.current).forEach((objectUrl) => {
        if (!String(objectUrl || '').startsWith('blob:')) return
        try {
          URL.revokeObjectURL(objectUrl)
        } catch {
          // Ignore object URL cleanup failures.
        }
      })
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadFullMediaHistory = async () => {
      if (!selectedUser?.username || !flow?.token) return
      setIsMediaLoading(true)
      setMediaLoadError('')

      try {
        const authKey = toConversationKeyPart(flow?.username)
        const peerKey = toConversationKeyPart(selectedUser?.username)
        const conversationKey = `${authKey}::${peerKey}`

        const mergeWithSeeded = (history) => {
          const mergedMediaByKey = new Map()
          const mergedFilesByKey = new Map()

          seededMediaItems.forEach((row) => {
            mergedMediaByKey.set(buildInfoMediaDedupeKey(row), row)
          })
          seededFileItems.forEach((row) => {
            mergedFilesByKey.set(buildInfoMediaDedupeKey(row), row)
          })

          const remoteMediaItems = Array.isArray(history?.mediaItems) ? history.mediaItems : []
          const remoteFileItems = Array.isArray(history?.fileItems) ? history.fileItems : []
          remoteMediaItems.forEach((item) => {
            mergedMediaByKey.set(buildInfoMediaDedupeKey(item), item)
          })
          remoteFileItems.forEach((item) => {
            mergedFilesByKey.set(buildInfoMediaDedupeKey(item), item)
          })

          const mergedMedia = [...mergedMediaByKey.values()]
          mergedMedia.sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))
          setMediaItems(mergedMedia)

          const mergedFiles = [...mergedFilesByKey.values()]
          mergedFiles.sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))
          setFileItems(mergedFiles)
        }

        const cachedHistory = readCachedInfoMediaHistory(conversationKey)
        if (cachedHistory) {
          if (!cancelled) {
            mergeWithSeeded(cachedHistory)
          }
          return
        }

        let historyPromise = infoMediaHistoryInFlight.get(conversationKey)
        if (!historyPromise) {
          historyPromise = (async () => {
            const remoteMediaByKey = new Map()
            const remoteFilesByKey = new Map()

            for (let page = 0; page < INFO_MEDIA_PAGE_LIMIT; page += 1) {
              const result = await getConversation(flow.token, selectedUser.username, {
                page,
                size: INFO_MEDIA_PAGE_SIZE,
              })
              const rows = Array.isArray(result?.messages) ? result.messages : []
              rows.forEach((row) => {
                const normalizedMedia = normalizeInfoMediaItem(row)
                if (normalizedMedia) {
                  remoteMediaByKey.set(buildInfoMediaDedupeKey(normalizedMedia), normalizedMedia)
                }
                const normalizedFile = normalizeInfoFileItem(row)
                if (normalizedFile) {
                  remoteFilesByKey.set(buildInfoMediaDedupeKey(normalizedFile), normalizedFile)
                }
              })

              const hasMore = Boolean(result?.hasMore)
              if (!hasMore || rows.length < INFO_MEDIA_PAGE_SIZE) break
            }

            const mediaItemsList = [...remoteMediaByKey.values()]
            mediaItemsList.sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))
            const fileItemsList = [...remoteFilesByKey.values()]
            fileItemsList.sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))

            return {
              mediaItems: mediaItemsList,
              fileItems: fileItemsList,
            }
          })()
            .then((history) => {
              infoMediaHistoryCache.set(conversationKey, {
                cachedAt: Date.now(),
                data: history,
              })
              return history
            })
            .finally(() => {
              if (infoMediaHistoryInFlight.get(conversationKey) === historyPromise) {
                infoMediaHistoryInFlight.delete(conversationKey)
              }
            })

          infoMediaHistoryInFlight.set(conversationKey, historyPromise)
        }

        const history = await historyPromise
        if (cancelled) return
        mergeWithSeeded(history)
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
  }, [flow?.token, flow?.username, seededFileItems, seededMediaItems, selectedUser?.username])

  const getRenderableMediaUrl = (url) => {
    const normalizedUrl = normalizeMediaUrl(url || '')
    if (!normalizedUrl) return ''
    return resolvedMediaUrlMap[normalizedUrl] || normalizedUrl
  }

  const ensureRenderableMediaUrl = async (url) => {
    const normalizedUrl = normalizeMediaUrl(url || '')
    if (!normalizedUrl) return ''
    if (/^(blob:|data:|content:|file:)/i.test(normalizedUrl)) return normalizedUrl
    if (resolvedMediaUrlRef.current[normalizedUrl]) return resolvedMediaUrlRef.current[normalizedUrl]
    if (mediaFetchPromiseRef.current[normalizedUrl]) return mediaFetchPromiseRef.current[normalizedUrl]
    const authToken = String(flow?.token || '').trim()
    if (!authToken) return normalizedUrl

    const pending = fetch(normalizedUrl, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`media-fetch-failed-${response.status}`)
        const blob = await response.blob()
        if (!(blob instanceof Blob) || !blob.size) throw new Error('media-fetch-empty')
        const objectUrl = URL.createObjectURL(blob)
        const previousUrl = resolvedMediaUrlRef.current[normalizedUrl]
        if (previousUrl && previousUrl !== objectUrl && String(previousUrl).startsWith('blob:')) {
          try {
            URL.revokeObjectURL(previousUrl)
          } catch {
            // Ignore object URL cleanup failures.
          }
        }
        resolvedMediaUrlRef.current[normalizedUrl] = objectUrl
        setResolvedMediaUrlMap((prev) => {
          if (prev[normalizedUrl] === objectUrl) return prev
          return { ...prev, [normalizedUrl]: objectUrl }
        })
        return objectUrl
      })
      .catch(() => normalizedUrl)
      .finally(() => {
        delete mediaFetchPromiseRef.current[normalizedUrl]
      })

    mediaFetchPromiseRef.current[normalizedUrl] = pending
    return pending
  }

  const handleOpenMediaPreview = async (item) => {
    const fallbackUrl = normalizeMediaUrl(item?.mediaUrl || '')
    if (!fallbackUrl) return
    const renderableUrl = await ensureRenderableMediaUrl(fallbackUrl)
    setActiveMediaPreview({
      type: item?.type === 'video' ? 'video' : 'image',
      url: renderableUrl || fallbackUrl,
      sourceUrl: fallbackUrl,
      name: item?.fileName || (item?.type === 'video' ? 'video' : 'image'),
    })
  }

  const handleMediaAssetError = (url) => {
    void ensureRenderableMediaUrl(url)
  }

  const triggerFileDownload = async (url, fileName) => {
    const downloadUrl = normalizeMediaUrl(url || '')
    if (!downloadUrl) return
    const downloadName = fileName || 'attachment'
    const authToken = String(flow?.token || '').trim()
    try {
      const response = await fetch(downloadUrl, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      if (!response.ok) throw new Error(`download-failed-${response.status}`)
      const blob = await response.blob()
      const blobUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = blobUrl
      anchor.download = downloadName
      anchor.rel = 'noreferrer'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 4000)
    } catch {
      window.open(downloadUrl, '_blank', 'noopener,noreferrer')
    }
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

      const subscriptionError = ''

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
        .map((item) => String(getRenderableMediaUrl(item.mediaUrl) || '').trim())
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
  }, [mediaItems, resolvedMediaUrlMap, videoThumbMap, isNativeRuntime])

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
                onClick={() => { void handleOpenMediaPreview(msg) }}
              >
                {msg.type === 'image' ? (
                  <img
                    className="chat-info-media-thumb"
                    src={getRenderableMediaUrl(msg.mediaUrl)}
                    alt={msg.fileName || 'image'}
                    loading="lazy"
                    onError={() => handleMediaAssetError(msg.mediaUrl)}
                  />
                ) : thumb ? (
                  <img className="chat-info-media-thumb" src={thumb} alt={msg.fileName || 'video thumbnail'} loading="lazy" />
                ) : (
                  <video
                    className="chat-info-media-thumb chat-info-video-thumb"
                    src={getRenderableMediaUrl(msg.mediaUrl)}
                    preload="metadata"
                    muted
                    playsInline
                    onError={() => handleMediaAssetError(msg.mediaUrl)}
                  />
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
                <button
                  type="button"
                  className="image-preview-send"
                  onClick={() => {
                    void triggerFileDownload(
                      activeMediaPreview.sourceUrl || activeMediaPreview.url,
                      activeMediaPreview.name || (activeMediaPreview.type === 'video' ? 'video' : 'image')
                    )
                  }}
                >
                  Download
                </button>
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

