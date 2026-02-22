import { useState, useRef, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Client } from '@stomp/stompjs'
import SockJS from 'sockjs-client'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { getMe } from '../services/authApi'
import { getConversation, uploadMedia } from '../services/messagesApi'
import { getAllUsers } from '../services/usersApi'
import BackIcon from '../components/BackIcon'
import { FileAttachIcon, PhotoAttachIcon } from '../components/AttachmentIcons'
import ChatUsersPanel from './ChatUsersPanel'
import {
  getNotificationPermissionState,
  getNotifyCutoff,
  pushNotify,
  setNotifyCutoff,
} from '../lib/notifications'
import { API_BASE_URL, WS_CHAT_URL } from '../config/apiConfig'
import { resetFlowState, useFlowState } from '../hooks/useFlowState'
import './ChatPageNew.css'

const REALTIME_TOAST_ID = 'realtime-connection'
const PRESENCE_LAST_SEEN_KEY = 'chat_presence_last_seen_v1'
const ACTIVE_CHAT_PEER_KEY_PREFIX = 'active_chat_peer_v1:'
const EDIT_WINDOW_MS = 15 * 60 * 1000
const MESSAGE_ACTION_LONG_PRESS_MS = 1000
const TYPING_STALE_MS = 1400
const QUICK_REACTIONS = [
  { code: 'heart', emoji: '❤️' },
  { code: 'laugh', emoji: '😂' },
  { code: 'wow', emoji: '😮' },
  { code: 'sad', emoji: '😢' },
  { code: 'angry', emoji: '😡' },
  { code: 'like', emoji: '👍' },
]
const REACTION_CODE_TO_EMOJI = QUICK_REACTIONS.reduce((acc, item) => ({ ...acc, [item.code]: item.emoji }), {})
const REACTION_EMOJI_TO_CODE = QUICK_REACTIONS.reduce((acc, item) => ({ ...acc, [item.emoji]: item.code }), {})

function ChatPageNew() {
  const navigate = useNavigate()
  const location = useLocation()
  const [flow, setFlow] = useFlowState()
  const [users, setUsers] = useState([])
  const [statusMap, setStatusMap] = useState({})
  const [typingMap, setTypingMap] = useState({})
  const [unreadMap, setUnreadMap] = useState({})
  const [seenAtMap, setSeenAtMap] = useState({})
  const [presenceLastSeenMap, setPresenceLastSeenMap] = useState(() => {
    if (typeof window === 'undefined') return {}
    try {
      const raw = window.localStorage.getItem(PRESENCE_LAST_SEEN_KEY)
      const parsed = raw ? JSON.parse(raw) : {}
      if (!parsed || typeof parsed !== 'object') return {}
      const normalized = {}
      Object.entries(parsed).forEach(([key, value]) => {
        const userKey = (key || '').trim().toLowerCase()
        const timestamp = Number(value || 0)
        if (!userKey || !timestamp) return
        normalized[userKey] = Math.max(Number(normalized[userKey] || 0), timestamp)
      })
      return normalized
    } catch {
      return {}
    }
  })
  const [selectedUser, setSelectedUser] = useState(null)
  const [conversationClears, setConversationClears] = useState({})
  const [messages, setMessages] = useState([])
  const [conversationReloadTick, setConversationReloadTick] = useState(0)
  const [usersReloadTick, setUsersReloadTick] = useState(0)
  const [inputValue, setInputValue] = useState('')
  const [presenceTick, setPresenceTick] = useState(Date.now())
  const [searchQuery, setSearchQuery] = useState('')
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const [pendingImagePreview, setPendingImagePreview] = useState(null)
  const [activeMediaPreview, setActiveMediaPreview] = useState(null)
  const [isMobileView, setIsMobileView] = useState(() => window.innerWidth <= 920)
  const [isTouchDevice, setIsTouchDevice] = useState(
    () => (typeof window !== 'undefined') && (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window)
  )
  const [showMobileUsers, setShowMobileUsers] = useState(() => {
    const requestedFromQuery = new URLSearchParams(location.search).get('with')
    const hasRouteSelection = Boolean(location.state?.selectedUserId || location.state?.selectedUsername || requestedFromQuery)
    return window.innerWidth <= 920 && !hasRouteSelection
  })
  const [replyingTo, setReplyingTo] = useState(null)
  const [editingMessage, setEditingMessage] = useState(null)
  const [draggedMessage, setDraggedMessage] = useState(null)
  const [isDraggingMessage, setIsDraggingMessage] = useState(false)
  const [activeMessageActionsKey, setActiveMessageActionsKey] = useState(null)
  const [socket, setSocket] = useState(null)
  const [isRecordingVoice, setIsRecordingVoice] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false)
  const [keyboardOffset, setKeyboardOffset] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 0))
  const [isIosPlatform, setIsIosPlatform] = useState(false)
  const [reactionTray, setReactionTray] = useState(null)
  const [videoThumbMap, setVideoThumbMap] = useState({})
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
  const typingTargetRef = useRef(null)
  const incomingTypingTimeoutsRef = useRef({})
  const sendAckTimeoutsRef = useRef({})
  const messageLongPressRef = useRef({
    timerId: null,
    key: null,
    message: null,
    startX: 0,
    startY: 0,
    moved: false,
    triggered: false,
    swiped: false,
  })
  const swipeTapSuppressUntilRef = useRef(0)
  const mediaRecorderRef = useRef(null)
  const recordingStreamRef = useRef(null)
  const recordingChunksRef = useRef([])
  const recordingTimerRef = useRef(null)
  const wsErrorToastAtRef = useRef(0)
  const wsResumeSuppressUntilRef = useRef(0)
  const wsLastHiddenAtRef = useRef(typeof Date !== 'undefined' ? Date.now() : 0)
  const wsErrorTimerRef = useRef(null)
  const offlineSinceRef = useRef({})
  const maxViewportHeightRef = useRef(0)
  const CLEAR_CUTOFFS_KEY = 'chat_clear_cutoffs_v1'

  const formatUsername = (name) => {
    const raw = (name || '').trim().replace(/^@+/, '')
    return raw || 'Unknown'
  }
  const toUserKey = (username) => (username || '').trim().toLowerCase()
  const activeChatKey = (meUsername) => `${ACTIVE_CHAT_PEER_KEY_PREFIX}${toUserKey(meUsername)}`
  const getAvatarLabel = (name) => {
    const normalized = formatUsername(name)
    if (normalized === 'Unknown') return '?'
    return normalized[0].toUpperCase()
  }
  const getUserDisplayName = (user) => {
    const name = (user?.name || '').trim()
    if (name) return name
    return formatUsername(user?.username)
  }
  const getTimeLabel = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const getConversationKey = (peerUsername) => `${(flow.username || '').toLowerCase()}::${(peerUsername || '').toLowerCase()}`
  const getConversationClearCutoff = (peerUsername) => conversationClears[getConversationKey(peerUsername)] || 0
  const getCapacitorKeyboard = async () => {
    const runtimeKeyboard = window?.Capacitor?.Plugins?.Keyboard
    if (runtimeKeyboard) return runtimeKeyboard
    try {
      const moduleName = '@capacitor/keyboard'
      const mod = await import(/* @vite-ignore */ moduleName)
      return mod?.Keyboard || null
    } catch {
      return null
    }
  }
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
    image: '\uD83D\uDDBC',
    video: '\u25B6',
    file: '\uD83D\uDCC4',
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
  const linkRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi
  const splitUrlSuffix = (token) => {
    const match = token.match(/[),.!?:;]+$/)
    if (!match) return { urlPart: token, suffix: '' }
    const suffix = match[0]
    return { urlPart: token.slice(0, token.length - suffix.length), suffix }
  }
  const renderTextWithLinks = (value) => {
    const text = String(value || '')
    if (!text) return null
    const parts = text.split(linkRegex)
    return parts.map((part, index) => {
      if (!part) return null
      const isUrlPart = /^https?:\/\//i.test(part) || /^www\./i.test(part)
      if (!isUrlPart) {
        return <span key={`txt-${index}`}>{part}</span>
      }
      const { urlPart, suffix } = splitUrlSuffix(part)
      const href = urlPart.startsWith('http') ? urlPart : `https://${urlPart}`
      return (
        <span key={`lnk-wrap-${index}`}>
          <a className="message-link" href={href} target="_blank" rel="noreferrer">
            {urlPart}
          </a>
          {suffix ? <span>{suffix}</span> : null}
        </span>
      )
    })
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
  const decodeReaction = (value) => {
    if (!value) return null
    const normalized = String(value).trim()
    if (!normalized) return null
    return REACTION_CODE_TO_EMOJI[normalized] || normalized
  }
  const encodeReaction = (emojiValue) => {
    if (!emojiValue) return null
    const normalized = String(emojiValue).trim()
    if (!normalized) return null
    return REACTION_EMOJI_TO_CODE[normalized] || normalized
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
  const getMessageUiKey = (message, index) => getMessageEditKey(message) || `${index}-${message?.createdAt || message?.timestamp || 'x'}-${message?.sender || 'u'}`
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
  const MAX_MEDIA_BYTES = 200 * 1024 * 1024
  const inferMediaKind = (inputFile) => {
    const mime = (inputFile?.type || '').toLowerCase()
    const name = (inputFile?.name || '').toLowerCase()
    if (mime.startsWith('video/')) return 'video'
    if (mime.startsWith('image/')) return 'image'
    if (/\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i.test(name)) return 'video'
    if (/\.(jpg|jpeg|png|gif|webp|heic|heif|bmp|svg)$/i.test(name)) return 'image'
    return 'file'
  }
  const gzipFile = async (inputFile) => {
    if (typeof window === 'undefined' || typeof window.CompressionStream === 'undefined') return null
    try {
      const gzip = new window.CompressionStream('gzip')
      const compressedStream = inputFile.stream().pipeThrough(gzip)
      const compressedBlob = await new Response(compressedStream).blob()
      const compressedName = inputFile.name?.toLowerCase?.().endsWith('.gz')
        ? inputFile.name
        : `${inputFile.name || 'attachment'}.gz`
      return new File([compressedBlob], compressedName, {
        type: 'application/gzip',
        lastModified: Date.now(),
      })
    } catch {
      return null
    }
  }
  const compressImageToLimit = async (inputFile, maxBytes) => {
    if (typeof window === 'undefined') return null
    try {
      const sourceUrl = URL.createObjectURL(inputFile)
      const image = await new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error('image-load-failed'))
        img.src = sourceUrl
      })
      URL.revokeObjectURL(sourceUrl)

      const baseWidth = Math.max(1, Number(image.naturalWidth || image.width || 0))
      const baseHeight = Math.max(1, Number(image.naturalHeight || image.height || 0))
      if (!baseWidth || !baseHeight) return null

      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')
      if (!context) return null

      const qualitySteps = [0.92, 0.85, 0.78, 0.7, 0.62, 0.55, 0.48, 0.4]
      let bestBlob = null

      for (let scaleStep = 0; scaleStep < 6; scaleStep += 1) {
        const scale = Math.max(0.28, 1 - (scaleStep * 0.14))
        const width = Math.max(1, Math.round(baseWidth * scale))
        const height = Math.max(1, Math.round(baseHeight * scale))
        canvas.width = width
        canvas.height = height
        context.clearRect(0, 0, width, height)
        context.drawImage(image, 0, 0, width, height)

        for (const quality of qualitySteps) {
          const blob = await new Promise((resolve) => {
            canvas.toBlob(resolve, 'image/jpeg', quality)
          })
          if (!blob) continue
          if (!bestBlob || blob.size < bestBlob.size) {
            bestBlob = blob
          }
          if (blob.size <= maxBytes) {
            const outputName = (inputFile.name || 'image').replace(/\.[^.]+$/, '') + '.jpg'
            return new File([blob], outputName, {
              type: 'image/jpeg',
              lastModified: Date.now(),
            })
          }
        }
      }

      if (bestBlob && bestBlob.size < inputFile.size) {
        const outputName = (inputFile.name || 'image').replace(/\.[^.]+$/, '') + '.jpg'
        return new File([bestBlob], outputName, {
          type: 'image/jpeg',
          lastModified: Date.now(),
        })
      }
      return null
    } catch {
      return null
    }
  }
  const compressMediaToLimit = async (inputFile, mediaType, maxBytes) => {
    if (!inputFile || inputFile.size <= maxBytes) {
      return { file: inputFile, compressed: false }
    }

    if (mediaType === 'image') {
      const imageCompressed = await compressImageToLimit(inputFile, maxBytes)
      if (imageCompressed && imageCompressed.size <= maxBytes) {
        return { file: imageCompressed, compressed: true }
      }
      const gzipCompressed = await gzipFile(inputFile)
      if (gzipCompressed && gzipCompressed.size <= maxBytes) {
        return { file: gzipCompressed, compressed: true }
      }
      return null
    }

    const gzipCompressed = await gzipFile(inputFile)
    if (gzipCompressed && gzipCompressed.size <= maxBytes) {
      return { file: gzipCompressed, compressed: true }
    }
    return null
  }
  const toShortLastSeen = (lastSeenAt) => {
    if (!lastSeenAt) return '-'
    const diffSeconds = Math.max(0, Math.floor((Date.now() - lastSeenAt) / 1000))
    if (diffSeconds < 60) return '1m ago'
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
    const userKey = toUserKey(username)
    const cachedLastSeenAt = Number(presenceLastSeenMap[userKey] || 0) || null
    const current = statusMap[userKey]
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
    const active = selectedUser?.username
    if (!active) return
    setUnreadMap((prev) => ({ ...prev, [toUserKey(active)]: false }))
  }, [selectedUser?.username])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!flow.username) return
    const key = activeChatKey(flow.username)
    if (selectedUser?.username) {
      try {
        window.localStorage.setItem(key, toUserKey(selectedUser.username))
      } catch {
        // Ignore localStorage failures.
      }
    } else {
      try {
        window.localStorage.removeItem(key)
      } catch {
        // Ignore localStorage failures.
      }
    }
    return () => {
      try {
        window.localStorage.removeItem(key)
      } catch {
        // Ignore localStorage failures.
      }
    }
  }, [flow.username, selectedUser?.username])

  useEffect(() => {
    setEditingMessage(null)
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
    const requestedFromQuery = new URLSearchParams(location.search).get('with')
    const hasRouteSelection = Boolean(location.state?.selectedUserId || location.state?.selectedUsername || requestedFromQuery)
    if (hasRouteSelection && !selectedUser) {
      setShowMobileUsers(false)
      return
    }
    setShowMobileUsers(!selectedUser)
  }, [isMobileView, selectedUser, location.state, location.search])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const platform = window.Capacitor?.getPlatform?.()
    const ua = window.navigator?.userAgent || ''
    const isiOS = platform === 'ios' || /iPad|iPhone|iPod/.test(ua)
    setIsIosPlatform(isiOS)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.Capacitor) return
    if (window.Capacitor.getPlatform?.() !== 'ios') return
    const hideAccessoryBar = async () => {
      try {
        const keyboard = await getCapacitorKeyboard()
        if (!keyboard?.setAccessoryBarVisible) return
        await keyboard.setAccessoryBarVisible({ isVisible: false })
      } catch {
        // Ignore when Keyboard plugin is unavailable.
      }
    }
    hideAccessoryBar()
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const getKeyboardOffset = () => {
      if (isIosPlatform) return 0
      const viewport = window.visualViewport
      const viewportHeight = Math.round(viewport?.height || window.innerHeight || 0)
      const viewportTop = Math.round(viewport?.offsetTop || 0)
      const effectiveHeight = viewportHeight + viewportTop

      if (effectiveHeight > maxViewportHeightRef.current) {
        maxViewportHeightRef.current = effectiveHeight
      }
      const baseline = maxViewportHeightRef.current || effectiveHeight
      const offset = Math.max(0, baseline - effectiveHeight)
      return offset > 40 ? offset : 0
    }

    const syncKeyboardFromViewport = () => {
      const viewport = window.visualViewport
      const viewportHeightNow = Math.round((viewport?.height || window.innerHeight || 0) + (viewport?.offsetTop || 0))
      setViewportHeight((prev) => {
        const next = viewportHeightNow || window.innerHeight
        return Math.abs((prev || 0) - next) <= 2 ? prev : next
      })
      if (!isIosPlatform) {
        const offset = getKeyboardOffset()
        setKeyboardOffset((prev) => (Math.abs((prev || 0) - offset) <= 2 ? prev : offset))
        setIsKeyboardOpen(offset > 0)
        return
      }
      setKeyboardOffset(0)
    }

    const onFocusIn = (event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (!target.closest('.message-input')) return
      setTimeout(syncKeyboardFromViewport, 0)
      setTimeout(syncKeyboardFromViewport, 220)
    }

    const onFocusOut = (event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (!target.closest('.message-input')) return
      setTimeout(syncKeyboardFromViewport, 60)
      setTimeout(syncKeyboardFromViewport, 260)
    }

    window.addEventListener('focusin', onFocusIn)
    window.addEventListener('focusout', onFocusOut)

    const viewport = window.visualViewport
    viewport?.addEventListener('resize', syncKeyboardFromViewport)
    window.addEventListener('resize', syncKeyboardFromViewport)
    window.addEventListener('orientationchange', syncKeyboardFromViewport)

    let isCancelled = false
    const handles = []
    const setupKeyboardListeners = async () => {
      if (!window.Capacitor) return
      try {
        const keyboard = await getCapacitorKeyboard()
        if (!keyboard?.addListener) return
        const onShow = (info) => {
          const nativeHeight = Number(info?.keyboardHeight || 0)
          if (nativeHeight > 0 && (!isIosPlatform || typeof window.visualViewport === 'undefined')) {
            setKeyboardOffset(nativeHeight)
          }
          setIsKeyboardOpen(true)
        }
        const onHide = () => {
          setKeyboardOffset(0)
          setIsKeyboardOpen(false)
          syncKeyboardFromViewport()
        }
        const showHandle = await keyboard.addListener('keyboardWillShow', onShow)
        const didShowHandle = await keyboard.addListener('keyboardDidShow', onShow)
        const hideHandle = await keyboard.addListener('keyboardWillHide', onHide)
        const didHideHandle = await keyboard.addListener('keyboardDidHide', onHide)
        if (isCancelled) {
          showHandle?.remove?.()
          didShowHandle?.remove?.()
          hideHandle?.remove?.()
          didHideHandle?.remove?.()
          return
        }
        handles.push(showHandle, didShowHandle, hideHandle, didHideHandle)
      } catch {
        // Keyboard plugin may be unavailable on web.
      }
    }

    setupKeyboardListeners()
    syncKeyboardFromViewport()
    return () => {
      isCancelled = true
      window.removeEventListener('focusin', onFocusIn)
      window.removeEventListener('focusout', onFocusOut)
      viewport?.removeEventListener('resize', syncKeyboardFromViewport)
      window.removeEventListener('resize', syncKeyboardFromViewport)
      window.removeEventListener('orientationchange', syncKeyboardFromViewport)
      handles.forEach((handle) => handle?.remove?.())
    }
  }, [isIosPlatform])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const videoUrls = [...new Set(
      messages
        .filter((msg) => msg?.type === 'video' && msg?.mediaUrl)
        .map((msg) => String(msg.mediaUrl))
    )]
    if (videoUrls.length === 0) return undefined

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
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          if (!ctx) return fail()
          ctx.drawImage(video, 0, 0, width, height)
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
      for (const url of videoUrls) {
        if (cancelled) return
        if (videoThumbMap[url] !== undefined) continue
        const thumb = await generateThumb(url)
        if (cancelled || !thumb) continue
        setVideoThumbMap((prev) => {
          if (prev[url]) return prev
          return { ...prev, [url]: thumb }
        })
      }
    }

    loadThumbs()
    return () => {
      cancelled = true
    }
  }, [messages, videoThumbMap])

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
  }, [flow.token, flow.username, isMobileView, usersReloadTick])

  useEffect(() => {
    if (!flow.username) return
    setConversationClears(readConversationClears())
  }, [flow.username])

  useEffect(() => {
    if (!flow.username) return
    writeConversationClears(conversationClears)
  }, [conversationClears, flow.username])

  useEffect(() => {
    if (!selectedUser) {
      setMessages([])
      return
    }
    const targetUsername = selectedUser.username
    const clearCutoff = getConversationClearCutoff(targetUsername)
    let cancelled = false
    getConversation(flow.token, targetUsername)
      .then((rows) => {
        if (cancelled) return
        if (selectedUserRef.current?.username !== targetUsername) return
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
          reaction: decodeReaction(row.reaction),
          replyingTo: row.replyText ? { text: row.replyText, senderName: row.replySenderName || row.senderName } : null,
          senderName: formatUsername(row.senderName),
          messageId: row.id || null,
          createdAt: row.createdAt || null,
          clientCreatedAt: Number(row.createdAt || 0) || null,
          timestamp: formatTimestamp(row.createdAt),
          edited: Boolean(row.edited || row.isEdited),
          editedAt: Number(row.editedAt || 0) || null,
        }))
        setMessages((prev) => {
          const pendingUploads = (prev || []).filter((msg) =>
            msg?.sender === 'user' &&
            msg?.deliveryStatus === 'uploading' &&
            msg?.tempId
          )
          if (!pendingUploads.length) return normalized
          return [...normalized, ...pendingUploads]
        })
        const latestIncoming = normalized
          .filter((msg) => msg.sender === 'other')
          .reduce((max, msg) => Math.max(max, Number(msg.createdAt || msg.clientCreatedAt || 0)), 0)
        if (latestIncoming && socket?.connected) {
          publishReadReceipt(targetUsername, latestIncoming)
        }
        setReplyingTo(null)
      })
      .catch((error) => {
        if (cancelled) return
        if (error?.response?.status === 401) {
          toast.error('Session expired. Please login again.')
          resetFlowState(setFlow)
          navigate('/auth')
          return
        }
        console.error('Failed loading conversation', error)
        toast.error('Failed to load conversation history.')
      })
    return () => {
      cancelled = true
    }
  }, [selectedUser, flow.token, conversationClears, conversationReloadTick])

  useEffect(() => {
    if (!flow.token || !flow.username) return
    const triggerRefresh = () => {
      setUsersReloadTick(Date.now())
      setConversationReloadTick(Date.now())
    }
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      triggerRefresh()
    }
    window.addEventListener('focus', triggerRefresh)
    window.addEventListener('online', triggerRefresh)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('focus', triggerRefresh)
      window.removeEventListener('online', triggerRefresh)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [flow.token, flow.username])

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
        if (wsErrorTimerRef.current) {
          clearTimeout(wsErrorTimerRef.current)
          wsErrorTimerRef.current = null
        }
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
            const userKey = toUserKey(username)
            if (!userKey) return
            setStatusMap((prev) => ({ ...prev, [userKey]: { status, lastSeenAt } }))
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
              reaction: decodeReaction(data?.reaction),
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
            if (!shouldSuppressChatNotification(fromUsername)) {
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
              setUnreadMap((prev) => ({ ...prev, [toUserKey(fromUsername)]: false }))
            } else {
              setUnreadMap((prev) => ({ ...prev, [toUserKey(fromUsername)]: true }))
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
            if (typing) {
              updatePresenceLastSeen(fromUsername, Date.now())
              if (incomingTypingTimeoutsRef.current[fromUsername]) {
                clearTimeout(incomingTypingTimeoutsRef.current[fromUsername])
              }
              incomingTypingTimeoutsRef.current[fromUsername] = setTimeout(() => {
                setTypingMap((prev) => ({ ...prev, [fromUsername]: false }))
                delete incomingTypingTimeoutsRef.current[fromUsername]
              }, TYPING_STALE_MS)
            } else if (incomingTypingTimeoutsRef.current[fromUsername]) {
              clearTimeout(incomingTypingTimeoutsRef.current[fromUsername])
              delete incomingTypingTimeoutsRef.current[fromUsername]
            }
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

        client.subscribe('/user/queue/message-reactions', (frame) => {
          try {
            const event = JSON.parse(frame.body)
            const messageId = Number(event?.messageId || 0)
            if (!messageId) return
            const nextReaction = decodeReaction(event?.reaction)
            setMessages((prev) => prev.map((msg) => (
              Number(msg?.messageId || 0) === messageId
                ? { ...msg, reaction: nextReaction }
                : msg
            )))
          } catch (error) {
            console.error('Failed parsing message reaction payload', error)
          }
        })
      },
      onWebSocketError: () => {
        if (Date.now() < Number(wsResumeSuppressUntilRef.current || 0)) return
        if (wsErrorTimerRef.current) return
        wsErrorTimerRef.current = setTimeout(() => {
          wsErrorTimerRef.current = null
          if (client.connected) return
          notifyRealtimeIssue('Realtime connection error (websocket).')
        }, 1500)
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
      if (wsErrorTimerRef.current) {
        clearTimeout(wsErrorTimerRef.current)
        wsErrorTimerRef.current = null
      }
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
            setUnreadMap((prev) => ({ ...prev, [toUserKey(user.username)]: true }))
            if (!shouldSuppressChatNotification(user.username)) {
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
      Object.values(incomingTypingTimeoutsRef.current).forEach((id) => clearTimeout(id))
      incomingTypingTimeoutsRef.current = {}
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

  const shouldSuppressChatNotification = (fromUsername) => {
    if (location.pathname !== '/chat') return false
    // App-level notifications handle chat-route delivery.
    return true
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
    const userKey = toUserKey(username)
    if (!userKey) return
    const nextTs = Number(timestampMs || 0)
    if (!nextTs) return
    setPresenceLastSeenMap((prev) => {
      const existing = Number(prev[userKey] || 0)
      if (nextTs <= existing) return prev
      return { ...prev, [userKey]: nextTs }
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

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target
      const isTypingTarget =
        target instanceof HTMLElement &&
        (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')

      if (isTypingTarget || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key?.toLowerCase() === 'v') {
        navigate('/chat')
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate])

  useEffect(() => () => {
    if (pendingImagePreview?.url) {
      URL.revokeObjectURL(pendingImagePreview.url)
    }
  }, [pendingImagePreview?.url])

  const publishTyping = (typing, force = false, targetUsername = null) => {
    const toUsername = (targetUsername || selectedUser?.username || '').trim()
    if (!toUsername) return
    if (!socket?.connected) {
      if (!typing) {
        typingStateRef.current = false
        if (typingTargetRef.current === toUsername) {
          typingTargetRef.current = null
        }
      }
      return
    }
    if (!force && typingTargetRef.current === toUsername && typingStateRef.current === typing) return
    typingStateRef.current = typing
    typingTargetRef.current = typing ? toUsername : (typingTargetRef.current === toUsername ? null : typingTargetRef.current)
    socket.publish({
      destination: '/app/chat.typing',
      body: JSON.stringify({
        toUsername,
        fromUsername: flow.username,
        typing,
      }),
    })
  }

  useEffect(() => {
    const nextUsername = selectedUser?.username || null
    const activeTypingTarget = typingTargetRef.current
    if (activeTypingTarget && activeTypingTarget !== nextUsername) {
      publishTyping(false, true, activeTypingTarget)
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current)
        typingTimeoutRef.current = null
      }
      typingStateRef.current = false
    }
  }, [selectedUser?.username, socket])

  useEffect(() => {
    const stopTypingOnSuspend = () => {
      const activeTypingTarget = typingTargetRef.current || selectedUserRef.current?.username
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current)
        typingTimeoutRef.current = null
      }
      if (activeTypingTarget) {
        publishTyping(false, true, activeTypingTarget)
      } else {
        typingStateRef.current = false
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        stopTypingOnSuspend()
      }
    }

    window.addEventListener('offline', stopTypingOnSuspend)
    window.addEventListener('pagehide', stopTypingOnSuspend)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('offline', stopTypingOnSuspend)
      window.removeEventListener('pagehide', stopTypingOnSuspend)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [socket, selectedUser?.username])

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
        const hasUnread = Boolean(unreadMap[toUserKey(user.username)])
        return {
          ...user,
          _presence: presence,
          _isTyping: isTyping,
          _hasUnread: hasUnread,
          _presenceTime: presenceTime,
        }
      }),
    [users, searchQuery, statusMap, typingMap, unreadMap, presenceTick]
  )
  const detailMediaItems = useMemo(
    () => messages.filter((msg) => msg.type && (msg.type === 'image' || msg.type === 'video') && msg.mediaUrl),
    [messages]
  )
  const openUserInfo = () => {
    if (!selectedUser) return
    navigate('/chat/info', {
      state: {
        selectedUser: {
          id: selectedUser.id || null,
          username: selectedUser.username || '',
          name: selectedUser.name || '',
        },
        selectedPresence: {
          status: selectedPresence.status || 'offline',
          lastSeenAt: selectedPresence.lastSeenAt || null,
        },
        selectedTyping,
        selectedSeen,
        notificationPermission,
        mediaItems: detailMediaItems.map((msg) => ({
          type: msg.type,
          mediaUrl: msg.mediaUrl,
          fileName: msg.fileName || null,
          createdAt: msg.createdAt || msg.clientCreatedAt || null,
        })),
      },
    })
  }

  useEffect(() => {
    const shouldOpenUsersList = Boolean(location.state?.openUsersList)
    const requestedUserId = location.state?.selectedUserId
    const requestedUsername = location.state?.selectedUsername
    const shouldRefreshConversation = Boolean(location.state?.refreshConversation)
    const clearForUsername = (location.state?.clearForUsername || '').trim()
    const clearCutoffAt = Number(location.state?.clearCutoffAt || 0)
    const requestedFromQuery = new URLSearchParams(location.search).get('with')
    const normalizedFromQuery = requestedFromQuery ? formatUsername(requestedFromQuery).toLowerCase() : ''
    if (clearForUsername && clearCutoffAt > 0 && flow.username) {
      const convoKey = `${(flow.username || '').toLowerCase()}::${clearForUsername.toLowerCase()}`
      setConversationClears((prev) => ({ ...prev, [convoKey]: clearCutoffAt }))
      if (selectedUserRef.current?.username?.toLowerCase() === clearForUsername.toLowerCase()) {
        setMessages([])
      }
    }
    if (shouldOpenUsersList) {
      setSelectedUser(null)
      setShowMobileUsers(true)
      navigate('/chat', { replace: true })
      return
    }
    if (shouldRefreshConversation) {
      setConversationClears(readConversationClears())
    }
    if (!requestedUserId && !requestedUsername && !normalizedFromQuery) {
      if (shouldRefreshConversation) {
        navigate('/chat', { replace: true })
      }
      return
    }
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
  }, [users, location.state, location.search, navigate, flow.username])

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
      const typingTarget = selectedUser.username
      typingTimeoutRef.current = setTimeout(() => {
        publishTyping(false, true, typingTarget)
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

  const waitForSocketConnected = async (timeoutMs = 12000, pollIntervalMs = 300) => {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      if (socket?.connected) return true
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
    }
    return Boolean(socket?.connected)
  }

  const sendMediaFile = async (file, type) => {
    if (!selectedUser || !file) return

    let resolvedType = type
    if (type === 'photo') {
      resolvedType = inferMediaKind(file)
    }

    let uploadFile = file
    const maxBytes = MAX_MEDIA_BYTES
    if (uploadFile.size > maxBytes) {
      toast.info('Large media detected. Compressing to fit 200MB limit...')
      const compressedResult = await compressMediaToLimit(uploadFile, resolvedType, maxBytes)
      if (!compressedResult?.file) {
        toast.error('Upload must be below 200MB. Compression could not reduce this media enough.')
        return
      }
      uploadFile = compressedResult.file
      if (compressedResult.compressed) {
        const beforeMb = Math.round(file.size / (1024 * 1024))
        const afterMb = Math.round(uploadFile.size / (1024 * 1024))
        toast.info(`Compressed media from ${beforeMb}MB to ${afterMb}MB`)
      }
    }

    if (uploadFile.size > maxBytes) {
      toast.error('Upload must be below 200MB.')
      return
    }

    const localPreviewUrl = URL.createObjectURL(uploadFile)
    const currentReply = replyingTo
    const targetUser = selectedUser
    const tempId = createTempId()
    const label = resolvedType === 'voice' ? 'voice message' : resolvedType
    const article = resolvedType === 'image' || resolvedType === 'audio' ? 'an' : 'a'

    setMessages((prev) => [...prev, {
      sender: 'user',
      type: resolvedType,
      text: `Sent ${article} ${label}`,
      fileName: uploadFile.name,
      mediaUrl: localPreviewUrl,
      mimeType: uploadFile.type,
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
          : `Sent a file (${uploadFile.name})`

    setUsers((prev) =>
      prev.map((user) =>
        user.username === targetUser.username
          ? { ...user, lastMessage: previewLabel, timestamp: getTimeLabel() }
          : user
      )
    )

    let uploaded
    try {
      uploaded = await uploadMedia(flow.token, uploadFile)
    } catch (error) {
      console.error('Media upload failed', error)
      if (error?.response?.status === 401) {
        toast.error('Session expired. Please login again.')
        resetFlowState(setFlow)
        navigate('/auth')
        return
      }
      if (error?.response?.status === 413) {
        toast.error('File exceeds upload limit (200MB max).')
        return
      }
      setMessages((prev) => prev.map((msg) => (msg.tempId === tempId ? { ...msg, deliveryStatus: 'failed' } : msg)))
      toast.error('Media upload failed. Please try a smaller file.')
      return
    }

    const uploadedUrl = normalizeMediaUrl(uploaded?.mediaUrl || localPreviewUrl)
    const uploadedMime = uploaded?.mimeType || uploadFile.type || null
    const uploadedFileName = uploaded?.fileName || uploadFile.name

    setMessages((prev) => prev.map((msg) => (
      msg.tempId === tempId
        ? { ...msg, mediaUrl: uploadedUrl, mimeType: uploadedMime, fileName: uploadedFileName }
        : msg
    )))

    const isRealtimeReady = await waitForSocketConnected(15000, 300)
    if (!isRealtimeReady) {
      setMessages((prev) => prev.map((msg) => (msg.tempId === tempId ? { ...msg, deliveryStatus: 'failed' } : msg)))
      toast.error('Media uploaded, but realtime is disconnected. Tap resend when connection returns.')
      return
    }

    try {
      socket.publish({
        destination: '/app/chat.send',
        body: JSON.stringify({
          toUsername: targetUser.username,
          fromUsername: flow.username,
          message: previewLabel,
          tempId,
          type: resolvedType,
          fileName: uploadedFileName,
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
      console.error('Realtime publish failed after upload', error)
      setMessages((prev) => prev.map((msg) => (msg.tempId === tempId ? { ...msg, deliveryStatus: 'failed' } : msg)))
      toast.error('Media uploaded, but send failed. Tap resend.')
    }
  }

  const handleFileUpload = async (event, type) => {
    const file = event?.target?.files?.[0]
    if (!file) return

    if (type === 'photo' && inferMediaKind(file) === 'image') {
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

  const beginTouchMessageGesture = (x, y, target, message, messageKey) => {
    if (!isTouchDevice) return
    if (!(target instanceof HTMLElement)) return
    if (!target.closest('.message-content')) return
    if (target.closest('button, a, audio, video, input, textarea')) return
    if (messageLongPressRef.current.timerId) {
      clearTimeout(messageLongPressRef.current.timerId)
    }
    messageLongPressRef.current = {
      timerId: setTimeout(() => {
        setActiveMessageActionsKey(messageKey)
        setReactionTray({ messageKey, x, y })
        messageLongPressRef.current.triggered = true
      }, MESSAGE_ACTION_LONG_PRESS_MS),
      key: messageKey,
      message,
      startX: x,
      startY: y,
      moved: false,
      triggered: false,
      swiped: false,
    }
  }

  const handleMessagePointerDown = (event, message, messageKey) => {
    if (!isTouchDevice) return
    beginTouchMessageGesture(event.clientX, event.clientY, event.target, message, messageKey)
  }

  const handleMessageTouchStart = (event, message, messageKey) => {
    if (!isTouchDevice) return
    const touch = event.touches?.[0]
    if (!touch) return
    beginTouchMessageGesture(touch.clientX, touch.clientY, event.target, message, messageKey)
  }

  const handleMessageGestureMove = (x, y) => {
    const state = messageLongPressRef.current
    if (!state?.message) return
    const dx = x - state.startX
    const dy = y - state.startY

    if (state.timerId && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      clearTimeout(state.timerId)
      messageLongPressRef.current.timerId = null
    }

    if (Math.abs(dy) > 44 && Math.abs(dy) > Math.abs(dx) + 8) {
      messageLongPressRef.current = { timerId: null, key: null, message: null, startX: 0, startY: 0, moved: true, triggered: false, swiped: false }
      return
    }

    const isOutgoing = state.message?.sender === 'user'
    const reachedReplySwipe = isOutgoing ? (dx < -56 && Math.abs(dy) < 34) : (dx > 56 && Math.abs(dy) < 34)
    if (!state.swiped && reachedReplySwipe) {
      setReplyingTo(state.message)
      setActiveMessageActionsKey(null)
      swipeTapSuppressUntilRef.current = Date.now() + 420
      messageLongPressRef.current = { timerId: null, key: null, message: null, startX: 0, startY: 0, moved: true, triggered: false, swiped: true }
    }
  }

  const handleMessagePointerMove = (event) => {
    if (!isTouchDevice) return
    handleMessageGestureMove(event.clientX, event.clientY)
  }

  const handleMessageTouchMove = (event) => {
    if (!isTouchDevice) return
    const touch = event.touches?.[0]
    if (!touch) return
    handleMessageGestureMove(touch.clientX, touch.clientY)
  }

  const handleMessagePointerEnd = () => {
    const state = messageLongPressRef.current
    if (state?.timerId) {
      clearTimeout(state.timerId)
    }
    messageLongPressRef.current = { timerId: null, key: null, message: null, startX: 0, startY: 0, moved: false, triggered: false, swiped: false }
  }

  const handleMessageTouchEnd = () => {
    const state = messageLongPressRef.current
    if (state?.timerId) {
      clearTimeout(state.timerId)
    }
    messageLongPressRef.current = { timerId: null, key: null, message: null, startX: 0, startY: 0, moved: false, triggered: false, swiped: false }
  }

  const handleMessageTap = (event, messageKey) => {
    if (!isTouchDevice) return
    if (Date.now() < swipeTapSuppressUntilRef.current) return
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (target.closest('button, a, audio, video, input, textarea')) return
    setReactionTray(null)
    setActiveMessageActionsKey((prev) => (prev === messageKey ? null : messageKey))
  }

  const getReactionTrayStyle = () => {
    if (!reactionTray || typeof window === 'undefined') return {}
    const trayWidth = 292
    const trayHeight = 54
    const pad = 8
    const left = Math.max(pad, Math.min(window.innerWidth - trayWidth - pad, reactionTray.x - (trayWidth / 2)))
    const prefersAbove = reactionTray.y > 86
    const top = prefersAbove
      ? Math.max(pad, reactionTray.y - trayHeight - 12)
      : Math.min(window.innerHeight - trayHeight - pad, reactionTray.y + 16)
    return { left: `${left}px`, top: `${top}px` }
  }

  const applyMessageReaction = (messageKey, emoji) => {
    const targetMessage = messages.find((msg, index) => getMessageUiKey(msg, index) === messageKey)
    if (!targetMessage) return
    const currentReaction = targetMessage.reaction || null
    const nextReaction = currentReaction === emoji ? null : emoji

    if (!targetMessage.messageId || !socket?.connected) {
      setMessages((prev) => prev.map((msg, index) => (
        getMessageUiKey(msg, index) === messageKey
          ? { ...msg, reaction: nextReaction }
          : msg
      )))
      if (!targetMessage.messageId) {
        toast.error('Reaction will sync after the message is sent.')
      }
      setReactionTray(null)
      setActiveMessageActionsKey(messageKey)
      return
    }

    setMessages((prev) => prev.map((msg) => (
      Number(msg?.messageId || 0) === Number(targetMessage.messageId || 0)
        ? { ...msg, reaction: nextReaction }
        : msg
    )))

    socket.publish({
      destination: '/app/chat.react',
      body: JSON.stringify({
        messageId: targetMessage.messageId,
        reaction: encodeReaction(nextReaction),
        fromUsername: flow.username,
      }),
    })

    setReactionTray(null)
    setActiveMessageActionsKey(messageKey)
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
      const thumb = videoThumbMap[message.mediaUrl] || null
      return (
        <button
          type="button"
          className="message-media-open"
          onClick={() => setActiveMediaPreview({ type: 'video', url: message.mediaUrl, name: message.fileName || 'video' })}
          aria-label="Open video preview"
        >
          <div className="message-video-thumb-shell">
            {thumb ? (
              <img className="message-video-thumb-image" src={thumb} alt={message.fileName || 'video thumbnail'} />
            ) : (
              <video className="message-video-preview" src={message.mediaUrl} preload="metadata" muted playsInline />
            )}
            <span className="message-video-play-icon">{icons.video}</span>
          </div>
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

  const handleSelectUserFromPanel = (user) => {
    setSelectedUser(user)
    setUnreadMap((prev) => ({ ...prev, [toUserKey(user.username)]: false }))
    if (isMobileView) {
      setShowMobileUsers(false)
    }
    setReactionTray(null)
  }

  const fallbackViewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0

  return (
    <div
      className={`chat-container ${selectedUser ? 'user-selected' : ''} ${showMobileUsers ? 'mobile-users-open' : ''} ${isKeyboardOpen ? 'keyboard-open' : ''}`}
      data-ios={isIosPlatform ? 'true' : 'false'}
      style={{
        '--chat-keyboard-offset': `${isIosPlatform ? 0 : Math.max(0, keyboardOffset)}px`,
        '--chat-viewport-height': `${Math.max(0, viewportHeight || fallbackViewportHeight)}px`,
      }}
    >
      <ChatUsersPanel
        filteredUsers={filteredUsers}
        selectedUserId={selectedUser?.id || null}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        onOpenGames={() => navigate('/games')}
        onStartNewChat={() => setSelectedUser(filteredUsers[0] || null)}
        onSelectUser={handleSelectUserFromPanel}
        getAvatarLabel={getAvatarLabel}
        getUserDisplayName={getUserDisplayName}
      />

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
              if (isMobileView) {
                setSelectedUser(null)
                setShowMobileUsers(true)
                return
              }
              setSelectedUser(null)
              setShowMobileUsers(true)
            }}
            title="Back to users"
            aria-label="Back to users"
          >
            <BackIcon />
          </button>
          <div
            className="chat-header-left chat-header-left-btn"
            onClick={openUserInfo}
            onTouchEnd={openUserInfo}
            onKeyDown={(event) => {
              if (!selectedUser) return
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                openUserInfo()
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
              className="btn-user-details"
              onClick={openUserInfo}
              onTouchEnd={openUserInfo}
              title="User info"
              aria-label="User info"
              disabled={!selectedUser}
            >
              i
            </button>
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

        <motion.div
          className="messages-area"
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onScroll={() => {
            setActiveMessageActionsKey(null)
            setReactionTray(null)
          }}
          onClick={(event) => {
            const target = event.target
            if (!(target instanceof HTMLElement)) return
            if (!target.closest('.message')) {
              setActiveMessageActionsKey(null)
              setReactionTray(null)
            }
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          <AnimatePresence>
            {messages.map((message, index) => {
              const messageKey = getMessageUiKey(message, index)
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
                onTouchStart={(event) => handleMessageTouchStart(event, message, messageKey)}
                onTouchMove={handleMessageTouchMove}
                onTouchEnd={handleMessageTouchEnd}
                onTouchCancel={handleMessageTouchEnd}
                onClick={(event) => handleMessageTap(event, messageKey)}
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
                      <div className="reply-text">{renderTextWithLinks(message.replyingTo.text)}</div>
                    </div>
                  )}
                  {renderMessageMedia(message)}
                  {message.fileName && message.type !== 'file' && <div className="message-file-name">{message.fileName}</div>}
                  {(message.type === 'text' || !message.type) && (
                    <div className="message-text">{renderTextWithLinks(message.text)}</div>
                  )}
                  {(message.type && message.type !== 'text' && !message.mediaUrl) && (
                    <div className="message-media-fallback">{renderTextWithLinks(`${getTypeIcon(message.type)} ${message.text}`.trim())}</div>
                  )}
                  <span className="message-time">{getMessageFooterLabel(message)}</span>
                  {shouldShowSeenInline && index === lastOutgoingIndex && activeMessageActionsKey !== messageKey && (
                    <span className="message-seen-inline">Seen</span>
                  )}
                  {message.reaction && (
                    <span className="message-reaction-badge" aria-label={`Reaction ${message.reaction}`}>
                      {message.reaction}
                    </span>
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
        {reactionTray && (
          <div className="reaction-tray" style={getReactionTrayStyle()}>
            {QUICK_REACTIONS.map((item) => (
              <button
                key={`${reactionTray.messageKey}-${item.code}`}
                type="button"
                className="reaction-tray-btn"
                onClick={() => applyMessageReaction(reactionTray.messageKey, item.emoji)}
                aria-label={`React ${item.emoji}`}
                title={`React ${item.emoji}`}
              >
                {item.emoji}
              </button>
            ))}
          </div>
        )}

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
                <PhotoAttachIcon className="attach-icon attach-icon-photo" />
              </button>
              {showAttachMenu && (
                <div className="attach-dropdown">
                  <button className="attach-item" onClick={() => { mediaInputRef.current?.click(); setShowAttachMenu(false) }} title="Send Photo" aria-label="Send photo">
                    <PhotoAttachIcon className="attach-icon attach-icon-photo" /> Photo
                  </button>
                  <button className="attach-item" onClick={() => { fileInputRef.current?.click(); setShowAttachMenu(false) }} title="Send File" aria-label="Send file">
                    <FileAttachIcon className="attach-icon attach-icon-file" /> File
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
            accept="*/*"
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

</div>
  )
}

export default ChatPageNew


