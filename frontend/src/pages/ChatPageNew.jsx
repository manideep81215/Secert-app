import { useState, useRef, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Client } from '@stomp/stompjs'
import SockJS from 'sockjs-client'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { getMe } from '../services/authApi'
import { getConversation, uploadMedia } from '../services/messagesApi'
import { getAllUsers } from '../services/usersApi'
import {
  ensureNotificationPermission,
  getNotificationBlockedHelp,
  getNotificationPermissionState,
  getNotifyCutoff,
  pushNotify,
  setNotifyCutoff,
} from '../lib/notifications'
import { ensurePushSubscription } from '../lib/pushSubscription'
import { getPushPublicKey } from '../services/pushApi'
import { API_BASE_URL, WS_CHAT_URL } from '../config/apiConfig'
import { resetFlowState, useFlowState } from '../hooks/useFlowState'
import './ChatPageNew.css'

const REALTIME_TOAST_ID = 'realtime-connection'
const PRESENCE_LAST_SEEN_KEY = 'chat_presence_last_seen_v1'
const EDIT_WINDOW_MS = 15 * 60 * 1000
const MESSAGE_ACTION_LONG_PRESS_MS = 600

function ChatPageNew() {
  const navigate = useNavigate()
  const location = useLocation()
  const [flow, setFlow] = useFlowState()
  const [users, setUsers] = useState([])
  const [statusMap, setStatusMap] = useState({})
  const [typingMap, setTypingMap] = useState({})
  const [seenAtMap, setSeenAtMap] = useState({})
  const [presenceLastSeenMap, setPresenceLastSeenMap] = useState(() => {
    if (typeof window === 'undefined') return {}
    try {
      const raw = window.localStorage.getItem(PRESENCE_LAST_SEEN_KEY)
      const parsed = raw ? JSON.parse(raw) : {}
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  })
  const [selectedUser, setSelectedUser] = useState(null)
  const [conversationClears, setConversationClears] = useState({})
  const [messages, setMessages] = useState([])
  const [inputValue, setInputValue] = useState('')
  const [presenceTick, setPresenceTick] = useState(Date.now())
  const [searchQuery, setSearchQuery] = useState('')
  const [showUserDetails, setShowUserDetails] = useState(false)
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const [showPushDebug, setShowPushDebug] = useState(false)
  const [pushDebug, setPushDebug] = useState({
    loading: false,
    notificationPermission: getNotificationPermissionState(),
    serviceWorkerActive: false,
    subscriptionExists: false,
    pushKeyRegistered: false,
    lastSyncAt: null,
    error: '',
  })
  const [pendingImagePreview, setPendingImagePreview] = useState(null)
  const [activeMediaPreview, setActiveMediaPreview] = useState(null)
  const [isMobileView, setIsMobileView] = useState(() => window.innerWidth <= 920)
  const [isTouchDevice, setIsTouchDevice] = useState(
    () => (typeof window !== 'undefined') && (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window)
  )
  const [showMobileUsers, setShowMobileUsers] = useState(() => window.innerWidth <= 920)
  const [replyingTo, setReplyingTo] = useState(null)
  const [editingMessage, setEditingMessage] = useState(null)
  const [draggedMessage, setDraggedMessage] = useState(null)
  const [isDraggingMessage, setIsDraggingMessage] = useState(false)
  const [activeMessageActionsKey, setActiveMessageActionsKey] = useState(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [socket, setSocket] = useState(null)
  const [isRecordingVoice, setIsRecordingVoice] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [notificationPermission, setNotificationPermission] = useState(
    getNotificationPermissionState()
  )
  const lastPublishedReadAtRef = useRef({})
  const mediaInputRef = useRef(null)
  const fileInputRef = useRef(null)
  const messagesEndRef = useRef(null)
  const selectedUserRef = useRef(null)
  const attachMenuRef = useRef(null)
  const typingTimeoutRef = useRef(null)
  const typingStateRef = useRef(false)
  const sendAckTimeoutsRef = useRef({})
  const messageLongPressRef = useRef({ timerId: null, key: null, startX: 0, startY: 0, moved: false, triggered: false })
  const mediaRecorderRef = useRef(null)
  const recordingStreamRef = useRef(null)
  const recordingChunksRef = useRef([])
  const recordingTimerRef = useRef(null)
  const wsErrorToastAtRef = useRef(0)
  const wsResumeSuppressUntilRef = useRef(0)
  const wsLastHiddenAtRef = useRef(typeof Date !== 'undefined' ? Date.now() : 0)
  const offlineSinceRef = useRef({})
  const CLEAR_CUTOFFS_KEY = 'chat_clear_cutoffs_v1'

  const formatUsername = (name) => {
    const raw = (name || '').trim().replace(/^@+/, '')
    return raw || 'Unknown'
  }
  const getAvatarLabel = (name) => {
    const normalized = formatUsername(name)
    if (normalized === 'Unknown') return '?'
    if (normalized.length === 1) return normalized.toUpperCase()
    return `${normalized[0]}${normalized[normalized.length - 1]}`.toUpperCase()
  }
  const getUserDisplayName = (user) => {
    const name = (user?.name || '').trim()
    if (name) return name
    return formatUsername(user?.username)
  }
  const getTimeLabel = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const getConversationKey = (peerUsername) => `${(flow.username || '').toLowerCase()}::${(peerUsername || '').toLowerCase()}`
  const getConversationClearCutoff = (peerUsername) => conversationClears[getConversationKey(peerUsername)] || 0
  const readConversationClears = () => {
    try {
      const raw = window.localStorage.getItem(CLEAR_CUTOFFS_KEY)
      const parsed = raw ? JSON.parse(raw) : {}
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  const writeConversationClears = (value) => {
    try {
      window.localStorage.setItem(CLEAR_CUTOFFS_KEY, JSON.stringify(value))
    } catch {
      // Ignore localStorage write failures.
    }
  }
  const icons = {
    image: '\u25A7',
    video: '\u25B6',
    file: '\u2398',
    voice: '\uD83C\uDFA4',
    reply: '\u21A9',
    delete: '\uD83D\uDDD1',
    edit: '\u270E',
    resend: '\u21BB',
    send: '\u27A4',
    game: '\uD83C\uDFAE',
  }
  const getTypeIcon = (type) => {
    if (type === 'image') return icons.image
    if (type === 'video') return icons.video
    if (type === 'file') return icons.file
    if (type === 'voice') return icons.voice
    return ''
  }
  const formatTimestamp = (value) => {
    if (!value) return getTimeLabel()
    return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  const normalizeMediaUrl = (url) => {
    if (!url) return null
    if (url.startsWith('/')) return `${API_BASE_URL}${url}`
    if (url.startsWith('http://localhost:8080')) {
      return `${API_BASE_URL}${url.slice('http://localhost:8080'.length)}`
    }
    return url
  }
  const getMessagePreview = (messageType, textValue, fileNameValue) => {
    if (messageType === 'image') return 'Sent an image'
    if (messageType === 'video') return 'Sent a video'
    if (messageType === 'voice') return 'Sent a voice message'
    if (messageType === 'file') return fileNameValue ? `Sent file: ${fileNameValue}` : 'Sent a file'
    return textValue || 'New message'
  }
  const getMessageCreatedAtMs = (message) => Number(message?.createdAt || message?.clientCreatedAt || 0)
  const isMessageFailed = (message) => message?.deliveryStatus === 'failed'
  const getMessageEditKey = (message) => {
    if (!message) return ''
    if (message.tempId) return `temp:${message.tempId}`
    if (message.messageId) return `id:${message.messageId}`
    const created = getMessageCreatedAtMs(message)
    return `local:${message.sender || 'x'}:${created}:${message.senderName || ''}`
  }
  const isSameMessage = (message, key) => getMessageEditKey(message) === key
  const canEditMessage = (message) => {
    if (!message || message.sender !== 'user') return false
    if (isMessageFailed(message)) return false
    if (message.type && message.type !== 'text') return false
    if (!message.messageId) return false
    const createdAt = getMessageCreatedAtMs(message)
    if (!createdAt) return false
    return (Date.now() - createdAt) <= EDIT_WINDOW_MS
  }
  const getMessageFooterLabel = (message) => {
    if (isMessageFailed(message)) return `Not sent · ${message.timestamp}`
    if (message?.deliveryStatus === 'uploading') return `Sending... · ${message.timestamp}`
    if (message?.edited) return `edited · ${message.timestamp}`
    return message?.timestamp || getTimeLabel()
  }
  const createTempId = () => (window.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`)
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024
  const MAX_VIDEO_BYTES = 20 * 1024 * 1024
  const MAX_OTHER_BYTES = 8 * 1024 * 1024
  const toShortLastSeen = (lastSeenAt) => {
    if (!lastSeenAt) return '-'
    const diffSeconds = Math.max(0, Math.floor((Date.now() - lastSeenAt) / 1000))
    if (diffSeconds < 60) return 'now'
    const minutes = Math.floor(diffSeconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }
  const toLongLastSeen = (lastSeenAt) => {
    if (!lastSeenAt) return 'offline'
    const diffSeconds = Math.max(0, Math.floor((Date.now() - lastSeenAt) / 1000))
    if (diffSeconds < 60) return 'last seen 1 min ago'
    const minutes = Math.floor(diffSeconds / 60)
    if (minutes < 60) return `last seen ${minutes} min ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `last seen ${hours} hr ago`
    const days = Math.floor(hours / 24)
    return `last seen ${days} day ago`
  }
  const getPresence = (username, fallback = 'offline') => {
    const cachedLastSeenAt = Number(presenceLastSeenMap[username] || 0) || null
    const current = statusMap[username]
    if (current) {
      return {
        ...current,
        lastSeenAt: current.lastSeenAt || cachedLastSeenAt,
      }
    }
    return { status: fallback, lastSeenAt: cachedLastSeenAt }
  }
  const getResolvedPresence = (username, fallback = 'offline') => {
    const presence = getPresence(username, fallback)
    if (presence.status === 'online') {
      delete offlineSinceRef.current[username]
      return presence
    }
    if (presence.lastSeenAt) {
      offlineSinceRef.current[username] = presence.lastSeenAt
      return presence
    }
    return presence
  }
  const selectedPresence = selectedUser ? getResolvedPresence(selectedUser.username, selectedUser.status) : { status: 'offline', lastSeenAt: null }
  const selectedTyping = selectedUser ? Boolean(typingMap[selectedUser.username]) : false
  const getLastOutgoingAt = (peerUsername) => {
    if (!peerUsername) return 0
    let latest = 0
    for (const msg of messages) {
      if (msg?.sender !== 'user') continue
      const createdAt = Number(msg?.createdAt || 0)
      if (createdAt > latest) latest = createdAt
    }
    return latest
  }
  const selectedLastOutgoingAt = selectedUser ? getLastOutgoingAt(selectedUser.username) : 0
  const selectedSeen = selectedUser
    ? Number(seenAtMap[(selectedUser.username || '').toLowerCase()] || 0) >= selectedLastOutgoingAt && selectedLastOutgoingAt > 0
    : false
  const lastOutgoingIndex = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.sender === 'user') return index
    }
    return -1
  }, [messages])
  const shouldShowSeenInline = Boolean(
    selectedUser &&
    !selectedTyping &&
    selectedSeen &&
    lastOutgoingIndex >= 0 &&
    lastOutgoingIndex === messages.length - 1
  )
  const getLatestIncomingCreatedAt = (peerUsername) => {
    if (!peerUsername) return 0
    let latest = 0
    for (const msg of messages) {
      if (msg?.sender !== 'other') continue
      if (formatUsername(msg?.senderName).toLowerCase() !== peerUsername.toLowerCase()) continue
      const createdAt = Number(msg?.createdAt || msg?.clientCreatedAt || 0)
      if (createdAt > latest) latest = createdAt
    }
    return latest
  }

  useEffect(() => {
    selectedUserRef.current = selectedUser
  }, [selectedUser])

  useEffect(() => {
    setEditingMessage(null)
  }, [selectedUser?.username])

  useEffect(() => {
    setShowDeleteConfirm(false)
  }, [selectedUser?.username])

  useEffect(() => {
    const onResize = () => {
      const mobile = window.innerWidth <= 920
      setIsMobileView(mobile)
      setIsTouchDevice(window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window)
      if (!mobile) {
        setShowMobileUsers(false)
      } else if (!selectedUserRef.current) {
        setShowMobileUsers(true)
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!isMobileView) return
    setShowMobileUsers(!selectedUser)
  }, [isMobileView, selectedUser])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.Capacitor) return
    if (window.Capacitor.getPlatform?.() !== 'ios') return
    const hideAccessoryBar = async () => {
      try {
        const moduleName = '@capacitor/keyboard'
        const mod = await import(/* @vite-ignore */ moduleName)
        const keyboard = mod?.Keyboard
        if (!keyboard?.setAccessoryBarVisible) return
        await keyboard.setAccessoryBarVisible({ isVisible: false })
      } catch {
        // Ignore when Keyboard plugin is unavailable.
      }
    }
    hideAccessoryBar()
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      setPresenceTick(Date.now())
    }, 30000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!flow.username || !flow.token) {
      navigate('/auth')
      return
    }
    if (!flow.verified) {
      navigate('/verify')
    }
  }, [flow.username, flow.token, flow.verified, navigate])

  useEffect(() => {
    if (!flow.token) return
    getMe(flow.token).catch((error) => {
      if (error?.response?.status === 401) {
        toast.error('Session expired, login again.')
        resetFlowState(setFlow)
        navigate('/auth')
      }
    })
  }, [flow.token, setFlow, navigate])

  useEffect(() => {
    if (!flow.token || !flow.username) return

    const loadUsersFromDb = async () => {
      try {
        const dbUsers = await getAllUsers(flow.token)
        const me = (flow.username || '').toLowerCase()
        const list = (dbUsers || [])
          .filter((user) => {
            const username = (user?.username || '').trim()
            return username && username.toLowerCase() !== me
          })
          .map((user) => ({
            id: user.id,
            username: (user.username || '').trim(),
            name: (user.name || '').trim(),
            status: 'offline',
            lastMessage: '',
            timestamp: '',
          }))

        setUsers(list)
        // Don't auto-select user - let user manually select from list
      } catch (error) {
        console.error('Failed loading users from database', error)
        toast.error('Failed to load users from database.')
      }
    }

    loadUsersFromDb()
  }, [flow.token, flow.username, isMobileView])

  useEffect(() => {
    if (!flow.username) return
    setConversationClears(readConversationClears())
  }, [flow.username])

  useEffect(() => {
    if (!flow.username) return
    writeConversationClears(conversationClears)
  }, [conversationClears, flow.username])

  useEffect(() => {
    if (!selectedUser) return
    const clearCutoff = getConversationClearCutoff(selectedUser.username)
    getConversation(flow.token, selectedUser.username)
      .then((rows) => {
        const filteredRows = (rows || []).filter((row) => {
          if (!clearCutoff) return true
          if (!row?.createdAt) return false
          return new Date(row.createdAt).getTime() > clearCutoff
        })
        const normalized = filteredRows.map((row) => ({
          sender: row.sender || 'other',
          text: row.text || '',
          type: row.type || null,
          fileName: row.fileName || null,
          mediaUrl: normalizeMediaUrl(row.mediaUrl),
          mimeType: row.mimeType || null,
          replyingTo: row.replyText ? { text: row.replyText, senderName: row.replySenderName || row.senderName } : null,
          senderName: formatUsername(row.senderName),
          messageId: row.id || null,
          createdAt: row.createdAt || null,
          clientCreatedAt: Number(row.createdAt || 0) || null,
          timestamp: formatTimestamp(row.createdAt),
          edited: Boolean(row.edited || row.isEdited),
          editedAt: Number(row.editedAt || 0) || null,
        }))
        setMessages(normalized)
        const latestIncoming = normalized
          .filter((msg) => msg.sender === 'other')
          .reduce((max, msg) => Math.max(max, Number(msg.createdAt || msg.clientCreatedAt || 0)), 0)
        if (latestIncoming && socket?.connected) {
          publishReadReceipt(selectedUser.username, latestIncoming)
        }
        setReplyingTo(null)
      })
      .catch((error) => {
        if (error?.response?.status === 401) {
          toast.error('Session expired. Please login again.')
          resetFlowState(setFlow)
          navigate('/auth')
          return
        }
        console.error('Failed loading conversation', error)
        toast.error('Failed to load conversation history.')
      })
  }, [selectedUser, flow.token, conversationClears])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [messages])

  useEffect(() => {
    if (!selectedUser?.username || !socket?.connected) return
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
    const latestIncoming = getLatestIncomingCreatedAt(selectedUser.username)
    if (!latestIncoming) return
    publishReadReceipt(selectedUser.username, latestIncoming)
  }, [messages, selectedUser?.username, socket?.connected])

  useEffect(() => {
    const authToken = (flow.token || '').trim()
    const authUsername = (flow.username || '').trim()
    if (!authToken || !authUsername) return

    const client = new Client({
      webSocketFactory: () => new SockJS(WS_CHAT_URL, null, {
        transports: ['websocket', 'xhr-streaming', 'xhr-polling'],
      }),
      connectHeaders: {
        username: authUsername,
        Authorization: `Bearer ${authToken}`,
      },
      heartbeatIncoming: 10000,
      heartbeatOutgoing: 10000,
      reconnectDelay: 600,
      connectionTimeout: 7000,
      onConnect: () => {
        client.publish({
          destination: '/app/user.online',
          body: JSON.stringify({ username: authUsername }),
        })

        const consumeStatus = (frame) => {
          try {
            const payload = JSON.parse(frame.body)
            const username = payload?.username
            const status = payload?.status
            const lastSeenAt = payload?.lastSeenAt || null
            if (!username || !status) return
            setStatusMap((prev) => ({ ...prev, [username]: { status, lastSeenAt } }))
            if (status === 'online') {
              updatePresenceLastSeen(username, Date.now())
            } else if (Number(lastSeenAt) > 0) {
              updatePresenceLastSeen(username, Number(lastSeenAt))
            }
          } catch (error) {
            console.error('Failed parsing user status payload', error)
          }
        }

        client.subscribe('/topic/user-status', consumeStatus)
        client.subscribe('/user/queue/user-status', consumeStatus)

        client.subscribe('/user/queue/messages', async (frame) => {
          try {
            const data = JSON.parse(frame.body)
            const fromUsername = data?.fromUsername
            const text = data?.message
            if (!fromUsername || !text) return
            const incomingCreatedAt = Number(data?.createdAt || Date.now())
            const clearCutoff = getConversationClearCutoff(fromUsername)
            if (clearCutoff && incomingCreatedAt <= clearCutoff) {
              return
            }

            setTypingMap((prev) => ({ ...prev, [fromUsername]: false }))

            const incoming = {
              sender: 'other',
              text,
              type: data?.type || null,
              fileName: data?.fileName || null,
              mediaUrl: normalizeMediaUrl(data?.mediaUrl || null),
              mimeType: data?.mimeType || null,
              replyingTo: data?.replyingTo || (data?.replyText ? { text: data.replyText, senderName: data?.replySenderName || fromUsername } : null),
              createdAt: incomingCreatedAt || null,
              clientCreatedAt: incomingCreatedAt || Date.now(),
              timestamp: getTimeLabel(),
              senderName: formatUsername(fromUsername),
              messageId: data?.id,
              edited: Boolean(data?.edited || data?.isEdited),
              editedAt: Number(data?.editedAt || 0) || null,
            }
            incoming.timestamp = formatTimestamp(incoming.createdAt)
            const incomingPreview = getMessagePreview(incoming.type, incoming.text, incoming.fileName)
            updatePresenceLastSeen(fromUsername, incomingCreatedAt || Date.now())
            if (!shouldSuppressChatNotification()) {
              await pushNotify(`@${formatUsername(fromUsername)}`, incomingPreview)
            }
            setNotifyCutoff(authUsername, fromUsername, incomingCreatedAt || Date.now())

            setUsers((prev) =>
              prev.map((user) =>
                user.username === fromUsername
                  ? { ...user, lastMessage: text, timestamp: getTimeLabel() }
                  : user
              )
            )

            if (selectedUserRef.current?.username === fromUsername) {
              // Update existing message or add new one
              setMessages((prev) => {
                const existingIndex = prev.findIndex((msg) => 
                  msg.text === incoming.text && 
                  msg.senderName === incoming.senderName &&
                  msg.sender === 'other' &&
                  msg.createdAt === null
                )
                if (existingIndex >= 0) {
                  const updated = [...prev]
                  updated[existingIndex] = { ...updated[existingIndex], ...incoming, createdAt: incoming.createdAt }
                  return updated
                }
                return [...prev, incoming]
              })
            }
          } catch (error) {
            console.error('Failed parsing message payload', error)
          }
        })

        client.subscribe('/user/queue/typing', (frame) => {
          try {
            const payload = JSON.parse(frame.body)
            const fromUsername = payload?.fromUsername
            const typing = Boolean(payload?.typing)
            if (!fromUsername) return
            setTypingMap((prev) => ({ ...prev, [fromUsername]: typing }))
            if (typing) updatePresenceLastSeen(fromUsername, Date.now())
          } catch (error) {
            console.error('Failed parsing typing payload', error)
          }
        })

        client.subscribe('/user/queue/send-ack', (frame) => {
          try {
            const ack = JSON.parse(frame.body)
            const tempId = ack?.tempId
            if (!tempId) return

            if (sendAckTimeoutsRef.current[tempId]) {
              clearTimeout(sendAckTimeoutsRef.current[tempId])
              delete sendAckTimeoutsRef.current[tempId]
            }

            setMessages((prev) =>
              prev.map((msg) => (
                msg.tempId === tempId
                  ? {
                      ...msg,
                      deliveryStatus: ack?.success ? 'sent' : 'failed',
                      messageId: ack?.messageId || ack?.id || msg.messageId || null,
                      createdAt: ack?.createdAt || msg.createdAt || null,
                      clientCreatedAt: ack?.createdAt || msg.clientCreatedAt || msg.createdAt || null,
                      timestamp: formatTimestamp(ack?.createdAt || msg.createdAt),
                    }
                  : msg
              ))
            )
          } catch (error) {
            console.error('Failed parsing send ack payload', error)
          }
        })

        client.subscribe('/user/queue/message-edits', (frame) => {
          try {
            const event = JSON.parse(frame.body)
            const messageId = Number(event?.messageId || 0)
            const nextText = event?.message
            if (!messageId || !nextText) return
            const nextEditedAt = Number(event?.editedAt || Date.now())
            setMessages((prev) => prev.map((msg) => (
              Number(msg?.messageId || 0) === messageId
                ? {
                    ...msg,
                    text: nextText,
                    edited: true,
                    editedAt: nextEditedAt,
                    timestamp: formatTimestamp(msg?.createdAt || msg?.clientCreatedAt),
                  }
                : msg
            )))
          } catch (error) {
            console.error('Failed parsing message edit payload', error)
          }
        })

        client.subscribe('/user/queue/edit-ack', (frame) => {
          try {
            const ack = JSON.parse(frame.body)
            if (ack?.success) return
            if (ack?.reason) {
              toast.error(`Edit failed: ${ack.reason}`)
            } else {
              toast.error('Edit failed.')
            }
          } catch {
            // Ignore invalid edit acks.
          }
        })

        client.subscribe('/user/queue/read-receipts', (frame) => {
          try {
            const receipt = JSON.parse(frame.body)
            const readerUsername = formatUsername(
              receipt?.readerUsername || receipt?.fromUsername || receipt?.username || ''
            ).toLowerCase()
            const readAt = Number(receipt?.readAt || receipt?.seenAt || receipt?.createdAt || 0)
            if (!readerUsername || !readAt) return
            setSeenAtMap((prev) => ({
              ...prev,
              [readerUsername]: Math.max(Number(prev[readerUsername] || 0), readAt),
            }))
          } catch (error) {
            console.error('Failed parsing read receipt payload', error)
          }
        })
      },
      onWebSocketError: () => {
        if (Date.now() < Number(wsResumeSuppressUntilRef.current || 0)) return
        notifyRealtimeIssue('Realtime connection error (websocket).')
      },
      onWebSocketClose: (event) => {
        const code = event?.code ?? 'n/a'
        if (code === 1000 || code === 1001) return
        const now = Date.now()
        const inResumeWindow = now < Number(wsResumeSuppressUntilRef.current || 0)
        const recentlyBackgrounded = now - Number(wsLastHiddenAtRef.current || 0) < 20000
        if ((code === 1006 || code === 1002) && (inResumeWindow || recentlyBackgrounded)) return
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return
        const reason = event?.reason ? `: ${event.reason}` : ''
        notifyRealtimeIssue(`Realtime disconnected (${code})${reason}`)
      },
      onStompError: (frame) => {
        const reason = frame?.headers?.message || frame?.body || 'STOMP broker error'
        notifyRealtimeIssue(`Realtime error: ${reason}`)
      },
    })

    client.activate()
    setSocket(client)

    return () => {
      if (client.connected) {
        client.publish({
          destination: '/app/user.offline',
          body: JSON.stringify({ username: authUsername }),
        })
      }
      client.deactivate()
    }
  }, [flow.token, flow.username])

  useEffect(() => {
    if (!flow.token || !flow.username || !users.length) return

    let cancelled = false
    let syncing = false

    const notifyMissedWhileOffline = async () => {
      if (syncing) return
      syncing = true
      try {
        for (const user of users) {
          if (cancelled) return
          try {
            const cutoff = getNotifyCutoff(flow.username, user.username)
            const rows = await getConversation(flow.token, user.username)
            if (cancelled) return

            const missed = (rows || [])
              .filter((row) => row?.sender === 'other')
              .filter((row) => Number(row?.createdAt || 0) > cutoff)

            if (!missed.length) continue

            const latest = Math.max(...missed.map((row) => Number(row.createdAt || 0)))
            setNotifyCutoff(flow.username, user.username, latest || Date.now())
            if (!shouldSuppressChatNotification()) {
              await pushNotify(`@${formatUsername(user.username)}`, `${missed.length} new message${missed.length > 1 ? 's' : ''}`)
            }
          } catch {
            // Ignore missed-notification sync failures per conversation.
          }
        }
      } finally {
        syncing = false
      }
    }

    const onResume = () => {
      if (document.visibilityState !== 'visible') return
      notifyMissedWhileOffline()
    }

    notifyMissedWhileOffline()
    window.addEventListener('focus', notifyMissedWhileOffline)
    window.addEventListener('online', notifyMissedWhileOffline)
    document.addEventListener('visibilitychange', onResume)
    return () => {
      cancelled = true
      window.removeEventListener('focus', notifyMissedWhileOffline)
      window.removeEventListener('online', notifyMissedWhileOffline)
      document.removeEventListener('visibilitychange', onResume)
    }
  }, [flow.token, flow.username, users])

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current)
      }
      Object.values(sendAckTimeoutsRef.current).forEach((id) => clearTimeout(id))
      sendAckTimeoutsRef.current = {}
      stopRecordingTimer()
      stopRecordingStream()
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
      mediaRecorderRef.current = null
    }
  }, [])

  useEffect(() => {
    const onWindowClick = (event) => {
      if (!attachMenuRef.current?.contains(event.target)) {
        setShowAttachMenu(false)
      }
    }
    window.addEventListener('click', onWindowClick)
    return () => window.removeEventListener('click', onWindowClick)
  }, [])

  useEffect(() => {
    const syncPermission = () => {
      setNotificationPermission(getNotificationPermissionState())
    }

    syncPermission()
    window.addEventListener('focus', syncPermission)
    document.addEventListener('visibilitychange', syncPermission)
    return () => {
      window.removeEventListener('focus', syncPermission)
      document.removeEventListener('visibilitychange', syncPermission)
    }
  }, [])

  const requestNotificationAccess = async () => {
    const granted = await ensureNotificationPermission(true)
    const current = granted ? 'granted' : (typeof Notification !== 'undefined' ? Notification.permission : 'unsupported')
    setNotificationPermission(current)
    if (granted) {
      toast.success('Notifications enabled.')
      await pushNotify('Notifications Enabled', 'You will get alerts for incoming and outgoing messages.')
      if (flow?.token) {
        await ensurePushSubscription(flow.token)
      }
      return
    }
    if (current === 'denied') {
      toast.error(getNotificationBlockedHelp(), { autoClose: 5500 })
    } else {
      toast.error('Notification permission not granted.')
    }
  }

  const notifyRealtimeIssue = (message) => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
    const now = Date.now()
    if (now < Number(wsResumeSuppressUntilRef.current || 0)) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    if (now - wsErrorToastAtRef.current < 3000) return
    wsErrorToastAtRef.current = now
    toast.clearWaitingQueue()
    toast.error(message, {
      toastId: REALTIME_TOAST_ID,
      autoClose: 1500,
    })
  }

  const shouldSuppressChatNotification = () => {
    if (typeof document === 'undefined') return false
    return document.visibilityState === 'visible' && location.pathname === '/chat'
  }

  useEffect(() => {
    if (typeof document === 'undefined') return
    const setResumeSuppression = (ms = 5000) => {
      wsResumeSuppressUntilRef.current = Date.now() + ms
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        wsLastHiddenAtRef.current = Date.now()
        return
      }
      setResumeSuppression(6000)
    }
    const onFocus = () => setResumeSuppression(4000)
    const onPageShow = () => setResumeSuppression(6000)

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onFocus)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(PRESENCE_LAST_SEEN_KEY, JSON.stringify(presenceLastSeenMap))
    } catch {
      // Ignore localStorage write failures.
    }
  }, [presenceLastSeenMap])

  const updatePresenceLastSeen = (username, timestampMs) => {
    if (!username) return
    const nextTs = Number(timestampMs || 0)
    if (!nextTs) return
    setPresenceLastSeenMap((prev) => {
      const existing = Number(prev[username] || 0)
      if (nextTs <= existing) return prev
      return { ...prev, [username]: nextTs }
    })
  }

  const clearPendingImagePreview = () => {
    setPendingImagePreview((prev) => {
      if (prev?.url) {
        URL.revokeObjectURL(prev.url)
      }
      return null
    })
  }

  const closeMediaPreview = () => {
    setActiveMediaPreview(null)
  }

  const refreshPushDebug = async (reason = 'manual') => {
    if (typeof window === 'undefined') return

    const snapshot = {
      loading: true,
      notificationPermission: getNotificationPermissionState(),
      serviceWorkerActive: false,
      subscriptionExists: false,
      pushKeyRegistered: false,
      lastSyncAt: pushDebug.lastSyncAt,
      error: '',
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

      // Try to provision subscription first, then read actual subscription state.
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
      let keyError = ''
      try {
        const keyConfig = await getPushPublicKey()
        pushKeyRegistered = Boolean(keyConfig?.enabled && keyConfig?.publicKey)
        if (!pushKeyRegistered) {
          keyError = 'Push key not configured on server.'
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
        lastSyncAt: Date.now(),
        error: combinedError,
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
        lastSyncAt: Date.now(),
        error: error?.message || 'Push debug check failed.',
      }
      setPushDebug(next)
      console.warn('[push-debug]', { reason, ...next })
    }
  }

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target
      const isTypingTarget =
        target instanceof HTMLElement &&
        (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')

      if (isTypingTarget || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key?.toLowerCase() === 'v') {
        navigate('/users')
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate])

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

  useEffect(() => () => {
    if (pendingImagePreview?.url) {
      URL.revokeObjectURL(pendingImagePreview.url)
    }
  }, [pendingImagePreview?.url])

  const publishTyping = (typing, force = false) => {
    if (!socket?.connected || !selectedUser?.username) return
    if (!force && typingStateRef.current === typing) return
    typingStateRef.current = typing
    socket.publish({
      destination: '/app/chat.typing',
      body: JSON.stringify({
        toUsername: selectedUser.username,
        fromUsername: flow.username,
        typing,
      }),
    })
  }

  const publishReadReceipt = (peerUsername, readAtMs) => {
    if (!socket?.connected || !peerUsername) return
    const nextReadAt = Number(readAtMs || 0)
    if (!nextReadAt) return
    const key = peerUsername.toLowerCase()
    const alreadySent = Number(lastPublishedReadAtRef.current[key] || 0)
    if (nextReadAt <= alreadySent) return
    lastPublishedReadAtRef.current[key] = nextReadAt
    socket.publish({
      destination: '/app/chat.read',
      body: JSON.stringify({
        peerUsername,
        readerUsername: flow.username,
        readAt: nextReadAt,
      }),
    })
  }

  const filteredUsers = useMemo(
    () => users
      .filter((user) => (user?.username || '').toLowerCase().includes(searchQuery.toLowerCase()))
      .map((user) => {
        const presence = getResolvedPresence(user.username, user.status)
        const isTyping = Boolean(typingMap[user.username])
        const presenceTime = presence.status === 'online' ? 'online' : toShortLastSeen(presence.lastSeenAt)
        return {
          ...user,
          _presence: presence,
          _isTyping: isTyping,
          _presenceTime: presenceTime,
        }
      }),
    [users, searchQuery, statusMap, typingMap, presenceTick]
  )
  const detailMediaItems = useMemo(
    () => messages.filter((msg) => msg.type && (msg.type === 'image' || msg.type === 'video') && msg.mediaUrl),
    [messages]
  )

  useEffect(() => {
    const requestedUserId = location.state?.selectedUserId
    const requestedUsername = location.state?.selectedUsername
    const requestedFromQuery = new URLSearchParams(location.search).get('with')
    const normalizedFromQuery = requestedFromQuery ? formatUsername(requestedFromQuery).toLowerCase() : ''
    if (!requestedUserId && !requestedUsername && !normalizedFromQuery) return
    if (!users.length) return

    const nextSelectedUser = users.find((user) =>
      (requestedUserId && user.id === requestedUserId) ||
      (requestedUsername && user.username === requestedUsername) ||
      (normalizedFromQuery && user.username.toLowerCase() === normalizedFromQuery)
    )

    if (nextSelectedUser) {
      setSelectedUser(nextSelectedUser)
      navigate('/chat', { replace: true })
    }
  }, [users, location.state, location.search, navigate])

  const handleSendMessage = async () => {
    const text = inputValue.trim()
    if (!text || !selectedUser) return

    if (editingMessage?.key) {
      const currentTarget = messages.find((msg) => isSameMessage(msg, editingMessage.key))
      if (!currentTarget) {
        toast.error('Message not found for edit.')
        setEditingMessage(null)
        return
      }
      if (!canEditMessage(currentTarget)) {
        toast.error('Message can only be edited within 15 minutes.')
        setEditingMessage(null)
        return
      }
      if (!socket?.connected) {
        toast.error('Realtime server disconnected. Edit not sent.')
        return
      }

      setMessages((prev) => prev.map((msg) => (
        isSameMessage(msg, editingMessage.key)
          ? { ...msg, text, edited: true, editedAt: Date.now() }
          : msg
      )))
      socket.publish({
        destination: '/app/chat.edit',
        body: JSON.stringify({
          messageId: currentTarget.messageId,
          message: text,
          fromUsername: flow.username,
        }),
      })
      setInputValue('')
      setEditingMessage(null)
      publishTyping(false, true)
      return
    }

    publishTyping(false, true)
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }

    const tempId = createTempId()
    const createdAtNow = Date.now()
    const outgoing = {
      sender: 'user',
      text,
      timestamp: getTimeLabel(),
      createdAt: createdAtNow,
      clientCreatedAt: createdAtNow,
      senderName: formatUsername(flow.username || 'You'),
      replyingTo,
      tempId,
      deliveryStatus: 'uploading',
    }

    setMessages((prev) => [...prev, outgoing])
    setInputValue('')
    setReplyingTo(null)

    setUsers((prev) =>
      prev.map((user) =>
        user.username === selectedUser.username
          ? { ...user, lastMessage: text, timestamp: getTimeLabel() }
          : user
      )
    )

    if (socket?.connected) {
      socket.publish({
        destination: '/app/chat.send',
        body: JSON.stringify({
          toUsername: selectedUser.username,
          message: text,
          fromUsername: flow.username,
          tempId,
          type: 'text',
          replyingTo: replyingTo ? { text: replyingTo.text, senderName: replyingTo.senderName } : null,
          replyText: replyingTo?.text || null,
          replySenderName: replyingTo?.senderName || null,
        }),
      })
      sendAckTimeoutsRef.current[tempId] = setTimeout(() => {
        setMessages((prev) => prev.map((msg) => (msg.tempId === tempId ? { ...msg, deliveryStatus: 'failed' } : msg)))
        delete sendAckTimeoutsRef.current[tempId]
      }, 10000)
    } else {
      setMessages((prev) => prev.map((msg) => (msg.tempId === tempId ? { ...msg, deliveryStatus: 'failed' } : msg)))
      toast.error('Realtime server disconnected. Message saved locally only.')
    }
  }

  const handleInputChange = (event) => {
    const nextValue = event.target.value
    setInputValue(nextValue)

    if (!selectedUser) return

    const hasText = nextValue.trim().length > 0
    publishTyping(hasText)

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }

    if (hasText) {
      typingTimeoutRef.current = setTimeout(() => {
        publishTyping(false, true)
      }, 1200)
    }
  }

  const stopRecordingTimer = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
  }

  const stopRecordingStream = () => {
    if (recordingStreamRef.current) {
      recordingStreamRef.current.getTracks().forEach((track) => track.stop())
      recordingStreamRef.current = null
    }
  }

  const sendMediaFile = async (file, type) => {
    if (!selectedUser || !file) return

    let resolvedType = type
    if (type === 'photo') {
      resolvedType = file.type?.startsWith('video') ? 'video' : 'image'
    }

    const maxBytes = resolvedType === 'video'
      ? MAX_VIDEO_BYTES
      : (resolvedType === 'image' ? MAX_IMAGE_BYTES : MAX_OTHER_BYTES)
    if (file.size > maxBytes) {
      const sizeMb = Math.round(maxBytes / (1024 * 1024))
      toast.error(`File too large. Maximum ${sizeMb}MB allowed.`)
      return
    }

    const localPreviewUrl = URL.createObjectURL(file)
    const currentReply = replyingTo
    const targetUser = selectedUser
    const tempId = createTempId()
    const label = resolvedType === 'voice' ? 'voice message' : resolvedType
    const article = resolvedType === 'image' || resolvedType === 'audio' ? 'an' : 'a'

    setMessages((prev) => [...prev, {
      sender: 'user',
      type: resolvedType,
      text: `Sent ${article} ${label}`,
      fileName: file.name,
      mediaUrl: localPreviewUrl,
      mimeType: file.type,
      timestamp: getTimeLabel(),
      senderName: formatUsername(flow.username || 'You'),
      replyingTo: currentReply,
      tempId,
      deliveryStatus: 'uploading',
    }])
    setReplyingTo(null)

    const previewLabel = resolvedType === 'image'
      ? 'Sent an image'
      : resolvedType === 'video'
        ? 'Sent a video'
        : resolvedType === 'voice'
          ? 'Sent a voice message'
          : `Sent a file (${file.name})`

    setUsers((prev) =>
      prev.map((user) =>
        user.username === targetUser.username
          ? { ...user, lastMessage: previewLabel, timestamp: getTimeLabel() }
          : user
      )
    )

    if (!socket?.connected) {
      setMessages((prev) => prev.map((msg) => (msg.tempId === tempId ? { ...msg, deliveryStatus: 'failed' } : msg)))
      toast.error('Realtime server disconnected. Message not sent.')
      return
    }

    try {
      const uploaded = await uploadMedia(flow.token, file)
      const uploadedUrl = normalizeMediaUrl(uploaded?.mediaUrl || localPreviewUrl)
      const uploadedMime = uploaded?.mimeType || file.type || null

      setMessages((prev) => prev.map((msg) => (
        msg.tempId === tempId
          ? { ...msg, mediaUrl: uploadedUrl, mimeType: uploadedMime, fileName: uploaded?.fileName || file.name }
          : msg
      )))

      socket.publish({
        destination: '/app/chat.send',
        body: JSON.stringify({
          toUsername: targetUser.username,
          fromUsername: flow.username,
          message: previewLabel,
          tempId,
          type: resolvedType,
          fileName: uploaded?.fileName || file.name,
          mediaUrl: uploadedUrl,
          mimeType: uploadedMime,
          replyingTo: currentReply ? { text: currentReply.text, senderName: currentReply.senderName } : null,
          replyText: currentReply?.text || null,
          replySenderName: currentReply?.senderName || null,
        }),
      })
      sendAckTimeoutsRef.current[tempId] = setTimeout(() => {
        setMessages((prev) => prev.map((msg) => (msg.tempId === tempId ? { ...msg, deliveryStatus: 'failed' } : msg)))
        delete sendAckTimeoutsRef.current[tempId]
      }, 12000)
    } catch (error) {
      console.error('Media upload failed', error)
      if (error?.response?.status === 401) {
        toast.error('Session expired. Please login again.')
        resetFlowState(setFlow)
        navigate('/auth')
        return
      }
      if (error?.response?.status === 413) {
        toast.error('File exceeds upload limit (photo/file 8MB, video 20MB).')
        return
      }
      setMessages((prev) => prev.map((msg) => (msg.tempId === tempId ? { ...msg, deliveryStatus: 'failed' } : msg)))
      toast.error('Media upload failed. Please try a smaller file.')
    }
  }

  const handleFileUpload = async (event, type) => {
    const file = event?.target?.files?.[0]
    if (!file) return

    if (type === 'photo' && file.type?.startsWith('image/')) {
      clearPendingImagePreview()
      const previewUrl = URL.createObjectURL(file)
      setPendingImagePreview({ file, url: previewUrl, name: file.name || 'image' })
    } else {
      await sendMediaFile(file, type)
    }

    if (event?.target) {
      event.target.value = ''
    }
  }

  const confirmImagePreviewSend = async () => {
    if (!pendingImagePreview?.file) return
    const file = pendingImagePreview.file
    clearPendingImagePreview()
    await sendMediaFile(file, 'photo')
  }

  const stopVoiceRecording = () => {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    } else {
      setIsRecordingVoice(false)
      setRecordingSeconds(0)
      stopRecordingTimer()
      stopRecordingStream()
      mediaRecorderRef.current = null
    }
  }

  const startVoiceRecording = async () => {
    if (!selectedUser) {
      toast.error('Select a user first.')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast.error('Voice recording is not supported on this browser.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const supportedMimeType = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
      ].find((mime) => MediaRecorder.isTypeSupported?.(mime))

      const recorder = supportedMimeType
        ? new MediaRecorder(stream, { mimeType: supportedMimeType })
        : new MediaRecorder(stream)

      recordingChunksRef.current = []
      recordingStreamRef.current = stream
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordingChunksRef.current.push(event.data)
        }
      }

      recorder.onerror = () => {
        toast.error('Voice recording failed.')
        setIsRecordingVoice(false)
        setRecordingSeconds(0)
        stopRecordingTimer()
        stopRecordingStream()
      }

      recorder.onstop = async () => {
        const chunks = recordingChunksRef.current
        recordingChunksRef.current = []
        stopRecordingTimer()
        stopRecordingStream()
        setIsRecordingVoice(false)
        setRecordingSeconds(0)
        mediaRecorderRef.current = null

        if (!chunks.length) return
        const blobType = recorder.mimeType || 'audio/webm'
        const blob = new Blob(chunks, { type: blobType })
        const extension = blobType.includes('mp4') ? 'm4a' : 'webm'
        const voiceFile = new File([blob], `voice-${Date.now()}.${extension}`, { type: blobType })
        await sendMediaFile(voiceFile, 'voice')
      }

      setRecordingSeconds(0)
      setIsRecordingVoice(true)
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1)
      }, 1000)
      recorder.start(250)
    } catch (error) {
      console.error('Unable to start voice recording', error)
      toast.error('Microphone permission denied or unavailable.')
      setIsRecordingVoice(false)
      setRecordingSeconds(0)
      stopRecordingTimer()
      stopRecordingStream()
      mediaRecorderRef.current = null
    }
  }

  const toggleVoiceRecording = async () => {
    if (isRecordingVoice) {
      stopVoiceRecording()
      return
    }
    await startVoiceRecording()
  }

  const handleResendMessage = (message) => {
    if (!selectedUser || !message || message.sender !== 'user') return
    if (!isMessageFailed(message)) return
    if (!socket?.connected) {
      toast.error('Realtime server disconnected. Message not sent.')
      return
    }

    const messageKey = getMessageEditKey(message)
    const type = message.type || 'text'
    const mediaUrl = message.mediaUrl || null
    if (type !== 'text' && (!mediaUrl || String(mediaUrl).startsWith('blob:'))) {
      toast.error('Cannot resend local media. Please upload the file again.')
      return
    }

    const nextTempId = createTempId()
    setMessages((prev) => prev.map((msg) => (
      isSameMessage(msg, messageKey)
        ? { ...msg, tempId: nextTempId, deliveryStatus: 'uploading' }
        : msg
    )))

    socket.publish({
      destination: '/app/chat.send',
      body: JSON.stringify({
        toUsername: selectedUser.username,
        fromUsername: flow.username,
        message: message.text || '',
        tempId: nextTempId,
        type,
        fileName: message.fileName || null,
        mediaUrl,
        mimeType: message.mimeType || null,
        replyingTo: message.replyingTo ? { text: message.replyingTo.text, senderName: message.replyingTo.senderName } : null,
        replyText: message.replyingTo?.text || null,
        replySenderName: message.replyingTo?.senderName || null,
      }),
    })
    sendAckTimeoutsRef.current[nextTempId] = setTimeout(() => {
      setMessages((prev) => prev.map((msg) => (msg.tempId === nextTempId ? { ...msg, deliveryStatus: 'failed' } : msg)))
      delete sendAckTimeoutsRef.current[nextTempId]
    }, 10000)
  }

  const handleStartEdit = (message) => {
    if (!canEditMessage(message)) {
      toast.error('Message can only be edited within 15 minutes.')
      return
    }
    setReplyingTo(null)
    setEditingMessage({
      key: getMessageEditKey(message),
      preview: message.text || '',
    })
    setInputValue(message.text || '')
    setActiveMessageActionsKey(null)
  }

  const cancelEditingMessage = () => {
    setEditingMessage(null)
    setInputValue('')
  }

  const requestDeleteChatForMe = () => {
    if (!selectedUser) return
    setShowDeleteConfirm(true)
  }

  const handleDeleteChatForMe = () => {
    if (!selectedUser) return

    const key = getConversationKey(selectedUser.username)
    const cutoffNow = Date.now()
    setConversationClears((prev) => {
      const next = { ...prev, [key]: cutoffNow }
      writeConversationClears(next)
      return next
    })
    setMessages([])
    setReplyingTo(null)
    setUsers((prev) =>
      prev.map((user) =>
        user.username === selectedUser.username
          ? { ...user, lastMessage: '', timestamp: '' }
          : user
      )
    )
    toast.success('Chat deleted for you.')
    setShowDeleteConfirm(false)
  }

  const handleReply = (message) => {
    setEditingMessage(null)
    setReplyingTo(message)
    setActiveMessageActionsKey(null)
  }

  const handleDragStart = (event, message) => {
    setDraggedMessage(message)
    setIsDraggingMessage(true)
    event.dataTransfer.effectAllowed = 'copy'
  }

  const handleDragOver = (event) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleDragEnd = () => {
    setIsDraggingMessage(false)
    setDraggedMessage(null)
  }

  const handleDrop = (event) => {
    event.preventDefault()
    if (draggedMessage) {
      setReplyingTo(draggedMessage)
      setDraggedMessage(null)
      setIsDraggingMessage(false)
    }
  }

  const handleMessagePointerDown = (event, message, messageKey) => {
    if (event.pointerType !== 'touch') return
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (!target.closest('.message-content')) return
    if (target.closest('button, a, audio, video, input, textarea')) return
    if (messageLongPressRef.current.timerId) {
      clearTimeout(messageLongPressRef.current.timerId)
    }
    messageLongPressRef.current = {
      timerId: setTimeout(() => {
        setActiveMessageActionsKey(messageKey)
        messageLongPressRef.current.triggered = true
      }, MESSAGE_ACTION_LONG_PRESS_MS),
      key: messageKey,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      triggered: false,
    }
  }

  const handleMessagePointerMove = (event) => {
    const state = messageLongPressRef.current
    if (!state?.timerId) return
    const dx = Math.abs(event.clientX - state.startX)
    const dy = Math.abs(event.clientY - state.startY)
    if (dx > 10 || dy > 10) {
      clearTimeout(state.timerId)
      messageLongPressRef.current = { timerId: null, key: null, startX: 0, startY: 0, moved: true, triggered: false }
    }
  }

  const handleMessagePointerEnd = () => {
    const state = messageLongPressRef.current
    if (state?.timerId) {
      clearTimeout(state.timerId)
    }
    messageLongPressRef.current = { timerId: null, key: null, startX: 0, startY: 0, moved: false, triggered: false }
  }

  const renderMessageMedia = (message) => {
    if (!message?.type || !message.mediaUrl) return null

    if (message.type === 'image') {
      return (
        <button
          type="button"
          className="message-media-open"
          onClick={() => setActiveMediaPreview({ type: 'image', url: message.mediaUrl, name: message.fileName || 'image' })}
          aria-label="Open image preview"
        >
          <img className="message-image-preview" src={message.mediaUrl} alt={message.fileName || 'image'} />
        </button>
      )
    }
    if (message.type === 'video') {
      return (
        <button
          type="button"
          className="message-media-open"
          onClick={() => setActiveMediaPreview({ type: 'video', url: message.mediaUrl, name: message.fileName || 'video' })}
          aria-label="Open video preview"
        >
          <video className="message-video-preview" src={message.mediaUrl} preload="metadata" />
        </button>
      )
    }
    if (message.type === 'voice') {
      return <audio className="message-audio-preview" src={message.mediaUrl} controls preload="metadata" />
    }
    if (message.type === 'file') {
      return (
        <a className="message-file-preview" href={message.mediaUrl} target="_blank" rel="noreferrer" download={message.fileName || 'attachment'}>
          {message.fileName || 'Download file'}
        </a>
      )
    }
    return null
  }

  return (
    <div className={`chat-container ${selectedUser ? 'user-selected' : ''} ${showMobileUsers ? 'mobile-users-open' : ''}`}>
      <motion.div
        className="users-panel"
        initial={{ x: -300 }}
        animate={{ x: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="users-header">
          <h2>Messages</h2>
          <button className="btn-new-chat" onClick={() => setSelectedUser(filteredUsers[0] || null)}>+</button>
        </div>
        <div className="users-search">
          <input
            type="text"
            placeholder="Search users..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            inputMode="text"
          />
        </div>
        <div className="users-list">
          <AnimatePresence>
            {filteredUsers.map((user) => (
              <motion.div
                key={user.id}
                className={`user-item ${selectedUser?.id === user.id ? 'active' : ''}`}
                onClick={() => {
                  setSelectedUser(user)
                  if (isMobileView) {
                    setShowMobileUsers(false)
                  }
                }}
                whileHover={{ x: 10 }}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <div className="user-avatar">{getAvatarLabel(getUserDisplayName(user))}</div>
                <div className="user-info">
                  <div className="user-name">{getUserDisplayName(user)}</div>
                  <div className="user-last-msg">{user._isTyping ? 'typing...' : (user.lastMessage || 'No messages yet')}</div>
                </div>
                <div className={`user-status ${user._presence.status === 'online' ? 'online' : 'offline'}`} />
                <div className="user-time">{user._presenceTime}</div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </motion.div>

      <div className="chat-area">
        <motion.div
          className="chat-header"
          initial={{ y: -60 }}
          animate={{ y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <button
            className="btn-back-mobile"
            onClick={() => {
              setSelectedUser(null)
              if (isMobileView) {
                setShowMobileUsers(true)
              }
            }}
            title="Back to users"
          >
            ←
          </button>
          <div
            className="chat-header-left chat-header-left-btn"
            onClick={() => selectedUser && setShowUserDetails(true)}
            onKeyDown={(event) => {
              if (!selectedUser) return
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                setShowUserDetails(true)
              }
            }}
            title={selectedUser ? 'Open user details' : 'Select a user'}
            aria-label={selectedUser ? 'Open user details' : 'Select a user'}
            role="button"
            tabIndex={selectedUser ? 0 : -1}
            aria-disabled={!selectedUser}
          >
            <div className="chat-user-avatar">{selectedUser ? getAvatarLabel(getUserDisplayName(selectedUser)) : '?'}</div>
            <div className="chat-user-info">
              <span className="chat-user-name chat-user-name-btn">
                {selectedUser ? getUserDisplayName(selectedUser) : 'Select a user'}
              </span>
              <div className={`chat-user-status ${selectedPresence.status === 'online' ? 'online' : 'offline'}`}>
                {selectedPresence.status === 'online' ? 'online' : toLongLastSeen(selectedPresence.lastSeenAt)}
              </div>
            </div>
          </div>
          <div className="chat-header-actions">
            <button
              className="btn-home-game"
              onClick={() => navigate('/games')}
              title="Go to dashboard"
              aria-label="Go to dashboard"
            >
              {icons.game}
            </button>
          </div>
        </motion.div>

        {showPushDebug && (
          <div className="push-debug-panel">
            <div className="push-debug-head">
              <strong>Push Debug</strong>
              <button type="button" onClick={() => refreshPushDebug('manual')} aria-label="Refresh push debug">Refresh</button>
            </div>
            <div className="push-debug-row"><span>Permission</span><b>{pushDebug.notificationPermission}</b></div>
            <div className="push-debug-row"><span>SW Active</span><b>{pushDebug.serviceWorkerActive ? 'yes' : 'no'}</b></div>
            <div className="push-debug-row"><span>Subscription</span><b>{pushDebug.subscriptionExists ? 'yes' : 'no'}</b></div>
            <div className="push-debug-row"><span>Push Key</span><b>{pushDebug.pushKeyRegistered ? 'yes' : 'no'}</b></div>
            <div className="push-debug-row">
              <span>Last Sync</span>
              <b>{pushDebug.lastSyncAt ? new Date(pushDebug.lastSyncAt).toLocaleTimeString() : '-'}</b>
            </div>
            {pushDebug.loading && <div className="push-debug-state">checking...</div>}
            {pushDebug.error && <div className="push-debug-error">{pushDebug.error}</div>}
          </div>
        )}

        <motion.div
          className="messages-area"
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onScroll={() => setActiveMessageActionsKey(null)}
          onClick={(event) => {
            const target = event.target
            if (!(target instanceof HTMLElement)) return
            if (!target.closest('.message')) {
              setActiveMessageActionsKey(null)
            }
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          <AnimatePresence>
            {messages.map((message, index) => {
              const messageKey = `${index}-${message.createdAt || message.timestamp}-${message.text}`
              const messageFailed = isMessageFailed(message)
              return (
              <motion.div
                key={messageKey}
                className={`message ${message.sender}`}
                draggable={!isTouchDevice}
                onDragStart={(event) => handleDragStart(event, message)}
                onDragEnd={handleDragEnd}
                onPointerDown={(event) => handleMessagePointerDown(event, message, messageKey)}
                onPointerMove={handleMessagePointerMove}
                onPointerUp={handleMessagePointerEnd}
                onPointerCancel={handleMessagePointerEnd}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                whileHover={{ scale: 1.02 }}
              >
                <div className={`message-content ${message.type === 'image' || message.type === 'video' ? 'has-media' : ''}`}>
                  {message.sender === 'user' && message.deliveryStatus === 'uploading' && (
                    <span className="message-upload-ring" title="Uploading" />
                  )}
                  {message.sender === 'user' && message.deliveryStatus === 'failed' && (
                    <span className="message-upload-failed" title="Failed">!</span>
                  )}
                  {message.replyingTo && (
                    <div className="message-reply-context">
                      <div className="reply-label">Replying to {message.replyingTo.senderName ? `@${formatUsername(message.replyingTo.senderName)}` : 'message'}:</div>
                      <div className="reply-text">{message.replyingTo.text}</div>
                    </div>
                  )}
                  {renderMessageMedia(message)}
                  {message.fileName && <div className="message-file-name">{message.fileName}</div>}
                  {(message.type === 'text' || !message.type) && (
                    <div className="message-text">{message.text}</div>
                  )}
                  {(message.type && message.type !== 'text' && !message.mediaUrl) && (
                    <div className="message-media-fallback">{`${getTypeIcon(message.type)} ${message.text}`.trim()}</div>
                  )}
                  <span className="message-time">{getMessageFooterLabel(message)}</span>
                  {shouldShowSeenInline && index === lastOutgoingIndex && activeMessageActionsKey !== messageKey && (
                    <span className="message-seen-inline">Seen</span>
                  )}
                </div>
                <div className={`message-actions ${activeMessageActionsKey === messageKey ? 'active' : ''}`}>
                  <button
                    className="btn-reply"
                    onClick={() => handleReply(message)}
                    title={messageFailed ? 'Cannot reply to unsent message' : 'Reply'}
                    aria-label="Reply"
                    disabled={messageFailed}
                  >
                    {icons.reply}
                  </button>
                  {message.sender === 'user' && !messageFailed && canEditMessage(message) && (
                    <button className="btn-edit" onClick={() => handleStartEdit(message)} title="Edit" aria-label="Edit">{icons.edit}</button>
                  )}
                  {message.sender === 'user' && messageFailed && (
                    <button className="btn-resend" onClick={() => handleResendMessage(message)} title="Resend" aria-label="Resend">{icons.resend}</button>
                  )}
                </div>
              </motion.div>
            )})}
          </AnimatePresence>
          <AnimatePresence>
            {selectedUser && selectedTyping && (
              <motion.div
                className="typing-indicator-row"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
              >
                <div className="typing-indicator-bubble" aria-label="Typing indicator">
                  <span />
                  <span />
                  <span />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </motion.div>

        <AnimatePresence>
          {editingMessage && (
            <motion.div
              className="reply-preview edit-preview"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
            >
              <div className="reply-info">
                <span className="reply-label">Editing message:</span>
                <span className="reply-msg">{editingMessage.preview}</span>
              </div>
              <button className="btn-cancel-reply" onClick={cancelEditingMessage}>X</button>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {replyingTo && (
            <motion.div
              className="reply-preview"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
            >
              <div className="reply-info">
                <span className="reply-label">Replying to @{formatUsername(replyingTo.senderName)}:</span>
                <span className="reply-msg">{replyingTo.text}</span>
              </div>
              <button className="btn-cancel-reply" onClick={() => setReplyingTo(null)}>X</button>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          className={`input-area ${isDraggingMessage ? 'drop-target' : ''}`}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          initial={{ y: 60 }}
          animate={{ y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="input-wrapper">
            <div className="input-actions" ref={attachMenuRef}>
              <button
                className="btn-action btn-plus"
                onClick={(event) => {
                  event.stopPropagation()
                  setShowAttachMenu((prev) => !prev)
                }}
                title="Attachments"
                aria-label="Open attachments menu"
              >
                +
              </button>
              <button
                className="btn-action attach-desktop-btn"
                onClick={(event) => {
                  event.stopPropagation()
                  setShowAttachMenu((prev) => !prev)
                }}
                title="Photo or file"
                aria-label="Open attachments menu"
              >
                {icons.image}
              </button>
              {showAttachMenu && (
                <div className="attach-dropdown">
                  <button className="attach-item" onClick={() => { mediaInputRef.current?.click(); setShowAttachMenu(false) }} title="Send Photo" aria-label="Send photo">
                    {icons.image} Photo
                  </button>
                  <button className="attach-item" onClick={() => { fileInputRef.current?.click(); setShowAttachMenu(false) }} title="Send File" aria-label="Send file">
                    {icons.file} File
                  </button>
                </div>
              )}
            </div>
            <div className="message-input-shell">
              <input
                type="text"
                className="message-input"
                placeholder="Type a message..."
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={(event) => event.key === 'Enter' && handleSendMessage()}
                onFocus={() => {
                  setTimeout(() => {
                    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
                  }, 300)
                }}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                inputMode="text"
                enterKeyHint="send"
              />
              <button
                className={`btn-voice-inline ${isRecordingVoice ? 'recording' : ''}`}
                onClick={toggleVoiceRecording}
                title={isRecordingVoice ? `Stop recording (${recordingSeconds}s)` : 'Record voice message'}
                aria-label={isRecordingVoice ? 'Stop recording' : 'Record voice message'}
              >
                {isRecordingVoice ? '■' : icons.voice}
              </button>
            </div>
            <button className="btn-send" onClick={handleSendMessage} aria-label="Send">{icons.send}</button>
          </div>
          <input
            type="file"
            ref={mediaInputRef}
            style={{ display: 'none' }}
            onChange={(event) => handleFileUpload(event, 'photo')}
            accept="image/*,video/*"
          />
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={(event) => handleFileUpload(event, 'file')}
          />
        </motion.div>
      </div>

      <AnimatePresence>
        {activeMediaPreview && (
          <motion.div
            className="image-preview-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="image-preview-backdrop" onClick={closeMediaPreview} />
            <motion.div
              className="image-preview-sheet media-preview-sheet"
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 16, opacity: 0 }}
            >
              <div className="image-preview-title">{activeMediaPreview.type === 'video' ? 'Preview video' : 'Preview image'}</div>
              {activeMediaPreview.type === 'video' ? (
                <video className="media-preview-video" src={activeMediaPreview.url} controls autoPlay playsInline />
              ) : (
                <img src={activeMediaPreview.url} alt={activeMediaPreview.name} className="image-preview-full" />
              )}
              <div className="image-preview-actions">
                <a
                  href={activeMediaPreview.url}
                  download={activeMediaPreview.name || (activeMediaPreview.type === 'video' ? 'video' : 'image')}
                  className="image-preview-send"
                >
                  Download
                </a>
                <button type="button" className="image-preview-cancel" onClick={closeMediaPreview}>Close</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pendingImagePreview && (
          <motion.div
            className="image-preview-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="image-preview-backdrop" onClick={clearPendingImagePreview} />
            <motion.div
              className="image-preview-sheet"
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 16, opacity: 0 }}
            >
              <div className="image-preview-title">Preview image</div>
              <img src={pendingImagePreview.url} alt={pendingImagePreview.name} className="image-preview-full" />
              <div className="image-preview-actions">
                <button type="button" className="image-preview-cancel" onClick={clearPendingImagePreview}>Cancel</button>
                <button type="button" className="image-preview-send" onClick={confirmImagePreviewSend}>Send</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showUserDetails && (
          <motion.div
            className="user-details-panel"
            initial={{ x: 300 }}
            animate={{ x: 0 }}
            exit={{ x: 300 }}
            transition={{ duration: 0.3 }}
          >
            <div className="details-header">
              <h3>User Details</h3>
              <button className="btn-close" onClick={() => setShowUserDetails(false)}>X</button>
            </div>
            <div className="details-content">
              <div className="details-avatar">
                <span className="details-avatar-name">{selectedUser ? getUserDisplayName(selectedUser) : '?'}</span>
              </div>
              <h2 className="details-name">{selectedUser ? getUserDisplayName(selectedUser) : '-'}</h2>
              <div className="details-quick-actions">
                <button
                  type="button"
                  className="details-quick-btn"
                  onClick={requestDeleteChatForMe}
                  title="Delete chat for me"
                  aria-label="Delete chat for me"
                  disabled={!selectedUser}
                >
                  <span className="details-quick-icon">{icons.delete}</span>
                  <span className="details-quick-label">Delete</span>
                </button>
                <button
                  type="button"
                  className={`details-quick-btn ${notificationPermission === 'granted' ? 'active' : ''}`}
                  onClick={requestNotificationAccess}
                  title={notificationPermission === 'granted' ? 'Notifications enabled' : 'Enable notifications'}
                  aria-label="Enable notifications"
                >
                  <span className="details-quick-icon">N</span>
                  <span className="details-quick-label">Notify</span>
                </button>
                <button
                  type="button"
                  className={`details-quick-btn ${showPushDebug ? 'active' : ''}`}
                  onClick={() => setShowPushDebug((prev) => !prev)}
                  title="Push debug info"
                  aria-label="Push debug info"
                >
                  <span className="details-quick-icon">D</span>
                  <span className="details-quick-label">Debug</span>
                </button>
                <button
                  type="button"
                  className="details-quick-btn"
                  onClick={() => setShowUserDetails(false)}
                  title="Back to chat"
                  aria-label="Back to chat"
                >
                  <span className="details-quick-icon">←</span>
                  <span className="details-quick-label">Back</span>
                </button>
              </div>
              <p className="details-status">
                {selectedTyping
                  ? 'typing...'
                  : (selectedPresence.status === 'online'
                      ? `${selectedSeen ? 'Seen · ' : ''}online`
                      : `${selectedSeen ? 'Seen · ' : ''}${toLongLastSeen(selectedPresence.lastSeenAt)}`)}
              </p>

              <div className="details-section">
                <h4>Contact Information</h4>
                <div className="detail-item">
                  <span className="detail-label">Name:</span>
                  <span className="detail-value">{selectedUser ? getUserDisplayName(selectedUser) : '-'}</span>
                </div>
              </div>

              <div className="details-section">
                <h4>Media</h4>
                <div className="media-grid">
                  {detailMediaItems.map((msg, idx) => (
                    <button
                      key={`${msg.mediaUrl || idx}-${idx}`}
                      type="button"
                      className="media-item"
                      title={msg.fileName || (msg.type === 'image' ? 'Image' : 'Video')}
                      onClick={() => setActiveMediaPreview({
                        type: msg.type === 'video' ? 'video' : 'image',
                        url: msg.mediaUrl,
                        name: msg.fileName || (msg.type === 'video' ? 'video' : 'image'),
                      })}
                    >
                      {msg.type === 'image' ? (
                        <img className="media-thumb" src={msg.mediaUrl} alt={msg.fileName || 'image'} loading="lazy" />
                      ) : (
                        <video className="media-thumb media-video-thumb" src={msg.mediaUrl} preload="metadata" muted playsInline />
                      )}
                      <span className="media-type-badge">{msg.type === 'video' ? 'Video' : 'Image'}</span>
                    </button>
                  ))}
                </div>
                {detailMediaItems.length === 0 && (
                  <p className="details-bio">No media shared yet.</p>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div
            className="confirm-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="confirm-modal-backdrop" onClick={() => setShowDeleteConfirm(false)} />
            <motion.div
              className="confirm-modal-card"
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 16, opacity: 0 }}
            >
              <div className="confirm-modal-title">Delete chat?</div>
              <div className="confirm-modal-text">
                Delete chat with {selectedUser ? getUserDisplayName(selectedUser) : 'this user'} for you only?
              </div>
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

export default ChatPageNew

