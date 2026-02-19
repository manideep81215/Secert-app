import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import {
  ensureNotificationPermission,
  getNotificationBlockedHelp,
  getNotificationPermissionState,
} from '../lib/notifications'
import { ensurePushSubscription } from '../lib/pushSubscription'
import { getPushPublicKey, sendTestPush } from '../services/pushApi'
import { useFlowState } from '../hooks/useFlowState'
import './ChatInfoPage.css'

const CLEAR_CUTOFFS_KEY = 'chat_clear_cutoffs_v1'

function ChatInfoPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [flow] = useFlowState()

  const selectedUser = location.state?.selectedUser || null
  const selectedPresence = location.state?.selectedPresence || { status: 'offline', lastSeenAt: null }
  const selectedTyping = Boolean(location.state?.selectedTyping)
  const selectedSeen = Boolean(location.state?.selectedSeen)
  const mediaItems = useMemo(() => {
    const rows = location.state?.mediaItems
    return Array.isArray(rows) ? rows.filter((row) => row?.mediaUrl) : []
  }, [location.state?.mediaItems])

  const [notificationPermission, setNotificationPermission] = useState(
    () => location.state?.notificationPermission || getNotificationPermissionState()
  )
  const [showPushDebug, setShowPushDebug] = useState(false)
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

  useEffect(() => {
    if (selectedUser?.username) return
    navigate('/chat', { replace: true })
  }, [navigate, selectedUser?.username])

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
    if (!lastSeenAt) return 'last seen unavailable'
    const diffSeconds = Math.max(0, Math.floor((Date.now() - Number(lastSeenAt)) / 1000))
    if (diffSeconds < 60) return 'last seen 1 min ago'
    const minutes = Math.floor(diffSeconds / 60)
    if (minutes < 60) return `last seen ${minutes} min ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `last seen ${hours} hr ago`
    const days = Math.floor(hours / 24)
    return `last seen ${days} day ago`
  }

  const statusLabel = selectedTyping
    ? 'typing...'
    : (selectedPresence.status === 'online'
        ? `${selectedSeen ? 'Seen · ' : ''}online`
        : `${selectedSeen ? 'Seen · ' : ''}${toLongLastSeen(selectedPresence.lastSeenAt)}`)

  const goBackToChat = () => {
    navigate('/chat', {
      replace: true,
      state: { selectedUsername: selectedUser?.username },
    })
  }

  const requestNotificationAccess = async () => {
    const granted = await ensureNotificationPermission(true)
    const current = granted ? 'granted' : (typeof Notification !== 'undefined' ? Notification.permission : 'unsupported')
    setNotificationPermission(current)
    if (granted) {
      toast.success('Notifications enabled.')
      if (flow?.token) {
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
      return
    }
    if (current === 'denied') {
      toast.error(getNotificationBlockedHelp(), { autoClose: 5500 })
    } else {
      toast.error('Notification permission not granted.')
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

    try {
      let registration = null
      if ('serviceWorker' in navigator) {
        registration = await navigator.serviceWorker.getRegistration('/sw.js')
        if (!registration) {
          registration = await navigator.serviceWorker.ready
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
      toast.error('Login required for test push.')
      return
    }
    try {
      const result = await sendTestPush(flow.token, {})
      if (result?.success) {
        toast.success(result?.message || 'Test push sent.')
      } else {
        toast.error(result?.message || 'Test push failed.')
      }
      refreshPushDebug('test-push')
    } catch (error) {
      const message = error?.response?.data?.message || error?.response?.data?.detail || 'Failed to send test push.'
      toast.error(message)
    }
  }

  const handleDeleteChatForMe = () => {
    if (!selectedUser?.username || !flow?.username) return
    const key = `${(flow.username || '').toLowerCase()}::${(selectedUser.username || '').toLowerCase()}`
    let current = {}
    try {
      const raw = window.localStorage.getItem(CLEAR_CUTOFFS_KEY)
      const parsed = raw ? JSON.parse(raw) : {}
      current = parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      current = {}
    }
    const next = { ...current, [key]: Date.now() }
    try {
      window.localStorage.setItem(CLEAR_CUTOFFS_KEY, JSON.stringify(next))
    } catch {
      // Ignore localStorage failures.
    }
    toast.success('Chat deleted for you.')
    setShowDeleteConfirm(false)
    navigate('/chat', {
      replace: true,
      state: {
        selectedUsername: selectedUser.username,
        refreshConversation: true,
      },
    })
  }

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

  if (!selectedUser) {
    return null
  }

  return (
    <div className="chat-info-page">
      <div className="chat-info-header">
        <button type="button" className="chat-info-back" onClick={goBackToChat} aria-label="Back to chat">←</button>
        <h2>User Details</h2>
      </div>

      <div className="chat-info-body">
        <div className="chat-info-avatar">{getAvatarLabel(getUserDisplayName(selectedUser))}</div>
        <h3 className="chat-info-name">{getUserDisplayName(selectedUser)}</h3>
        <p className="chat-info-status">{statusLabel}</p>

        <div className="chat-info-actions">
          <button type="button" className="chat-info-action" onClick={() => setShowDeleteConfirm(true)} aria-label="Delete chat">
            <span className="chat-info-action-icon">Del</span>
            <span className="chat-info-action-label">Delete</span>
          </button>
          <button type="button" className={`chat-info-action ${notificationPermission === 'granted' ? 'active' : ''}`} onClick={requestNotificationAccess} aria-label="Enable notifications">
            <span className="chat-info-action-icon">N</span>
            <span className="chat-info-action-label">Notify</span>
          </button>
          <button type="button" className={`chat-info-action ${showPushDebug ? 'active' : ''}`} onClick={() => setShowPushDebug((prev) => !prev)} aria-label="Toggle debug panel">
            <span className="chat-info-action-icon">D</span>
            <span className="chat-info-action-label">Debug</span>
          </button>
          <button type="button" className="chat-info-action" onClick={goBackToChat} aria-label="Back to chat">
            <span className="chat-info-action-icon">←</span>
            <span className="chat-info-action-label">Back</span>
          </button>
        </div>

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
          <div className="chat-info-media-grid">
            {mediaItems.map((msg, idx) => (
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
                ) : (
                  <video className="chat-info-media-thumb chat-info-video-thumb" src={msg.mediaUrl} preload="metadata" muted playsInline />
                )}
                <span className="chat-info-media-badge">{msg.type === 'video' ? 'Video' : 'Image'}</span>
              </button>
            ))}
          </div>
          {mediaItems.length === 0 && (
            <p className="chat-info-empty">No media shared yet.</p>
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
