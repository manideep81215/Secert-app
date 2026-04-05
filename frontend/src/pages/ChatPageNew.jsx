import { useState, useRef, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Client } from '@stomp/stompjs'
import SockJS from 'sockjs-client'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { registerPlugin } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { Haptics, ImpactStyle } from '@capacitor/haptics'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { getMe } from '../services/authApi'
import {
  consumeCheckNotice,
  getChatStats,
  getConversation,
  getConversationSummaries,
  reportChatOpen,
  uploadMedia,
} from '../services/messagesApi'
import { getAllUsers } from '../services/usersApi'
import BackIcon from '../components/BackIcon'
import { CameraAttachIcon, FileAttachIcon, PhotoAttachIcon, DriveAttachIcon } from '../components/AttachmentIcons'
import LoveReminder from '../components/LoveReminder'
import LoveJourneyPopupHost from '../components/LoveJourneyPopupHost'
import MonthlyRecap from '../components/MonthlyRecap'
import MilestonePopup from '../components/MilestonePopup'
import LovePercentageChip from '../components/LovePercentageChip'
import CheckedForYouPopup from '../components/CheckedForYouPopup'
// import SnapCameraScreen from '../components/SnapCameraScreen' // DISABLED: Snap Camera feature
import SecretTapButton from '../components/SecretTapButton'
// import snapIcon from '../assets/snap.png' // DISABLED: Snap Camera feature
import timerLoveBirdsIcon from '../assets/in-love.png'
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

const notify = { success: () => {}, error: () => {}, info: () => {}, warn: () => {}, clearWaitingQueue: () => {} }
const OpenFile = registerPlugin('OpenFile')

const REALTIME_TOAST_ID = 'realtime-connection'
const PRESENCE_LAST_SEEN_KEY = 'chat_presence_last_seen_v1'
const ACTIVE_CHAT_PEER_KEY_PREFIX = 'active_chat_peer_v1:'
const NATIVE_CHAT_PAGE_ACTIVE_KEY = 'chat_page_active_v1'
const EDIT_WINDOW_MS = 15 * 60 * 1000
const MESSAGE_ACTION_LONG_PRESS_MS = 1000
const MESSAGE_REPLY_SWIPE_TRIGGER_PX = 56
const MESSAGE_REPLY_SWIPE_TRIGGER_OUTGOING_PX = 24
const MESSAGE_REPLY_SWIPE_MAX_PX = 96
const MESSAGE_REPLY_SWIPE_CANCEL_Y_PX = 52
const TYPING_STALE_MS = 1400
const ONLINE_HEARTBEAT_MS = 30 * 1000
const AUTO_REFRESH_DEBOUNCE_MS = 1200
const TEXT_SEND_WAIT_MS = 1500
const MEDIA_SEND_WAIT_MS = 2000
const SEND_ACK_TIMEOUT_MS = 20000
const USERS_SUMMARY_TIMEOUT_MS = 2200
const CONVERSATION_FETCH_RETRY_LIMIT = 4
const CONVERSATION_PAGE_SIZE = 50
const MAX_MESSAGES_IN_MEMORY = 100  // Keep only latest 100 messages in state to save RAM
const CONVERSATION_SCROLL_TOP_THRESHOLD = 140
const AUTO_SCROLL_BOTTOM_THRESHOLD = 120
const MISSED_SCAN_PAGE_LIMIT = 12
const OFFLINE_DASHBOARD_REDIRECT_MS = 60 * 1000
const SECRET_TAP_TYPE = 'secret-tap'
const TONY_USERNAME = 'tony'
const QUICK_REACTIONS = [
  { code: 'heart', emoji: '❤️' },
  { code: 'laugh', emoji: '😂' },
  { code: 'wow', emoji: '😮' },
  { code: 'sad', emoji: '😢' },
  { code: 'angry', emoji: '😡' },
  { code: 'like', emoji: '👍' },
]
const PLACEHOLDER_REACTION_EMOJI = '😘'
const REACTION_CODE_TO_EMOJI = QUICK_REACTIONS.reduce((acc, item) => ({ ...acc, [item.code]: item.emoji }), {})
const REACTION_EMOJI_TO_CODE = QUICK_REACTIONS.reduce((acc, item) => ({ ...acc, [item.emoji]: item.code }), {})

function getNormalizedRoutePath(location) {
  const pathname = String(location?.pathname || '').trim()
  const hashPath = typeof window !== 'undefined'
    ? String(window.location.hash || '').replace(/^#/, '').trim()
    : ''
  const normalizedHash = hashPath ? (hashPath.startsWith('/') ? hashPath : `/${hashPath}`) : ''
  if (normalizedHash) return normalizedHash.toLowerCase()
  return pathname.toLowerCase()
}

function getViewportFallbackHeight() {
  if (typeof window === 'undefined') return 0
  const innerHeight = Math.round(window.innerHeight || 0)
  const visualHeight = Math.round(window.visualViewport?.height || 0)
  const docHeight = Math.round(window.document?.documentElement?.clientHeight || 0)
  const screenHeight = Math.round(window.screen?.height || 0)
  return visualHeight || innerHeight || docHeight || screenHeight || 0
}

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
  const [hasOlderMessages, setHasOlderMessages] = useState(false)
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false)
  const [conversationReloadTick, setConversationReloadTick] = useState(0)
  const [usersReloadTick, setUsersReloadTick] = useState(0)
  const [lastSentMessageId, setLastSentMessageId] = useState(0)
  const [milestoneTriggerTick, setMilestoneTriggerTick] = useState(0)
  const [headerStats, setHeaderStats] = useState({ todayMessages: 0, yesterdayMessages: 0, dailyAverage: 0 })
  const [inputValue, setInputValue] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  // const [isSnapCameraOpen, setIsSnapCameraOpen] = useState(false) // DISABLED: Snap Camera feature
  const [pendingImagePreview, setPendingImagePreview] = useState(null)
  const [isPendingImageSending, setIsPendingImageSending] = useState(false)
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
  const [swipingMessage, setSwipingMessage] = useState({ key: null, offset: 0 })
  const [activeMessageActionsKey, setActiveMessageActionsKey] = useState(null)
  const [socket, setSocket] = useState(null)
  const [isManualRefreshing, setIsManualRefreshing] = useState(false)
  const [isRecordingVoice, setIsRecordingVoice] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [isCameraLoading, setIsCameraLoading] = useState(false)
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false)
  const [keyboardOffset, setKeyboardOffset] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(() => getViewportFallbackHeight())
  const [visualViewportTop, setVisualViewportTop] = useState(0)
  const [visualViewportBottomGap, setVisualViewportBottomGap] = useState(0)
  const [isIosPlatform, setIsIosPlatform] = useState(false)
  const [isAndroidPlatform, setIsAndroidPlatform] = useState(false)
  const [reactionTray, setReactionTray] = useState(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [pendingDeleteMessage, setPendingDeleteMessage] = useState(null)
  const [videoThumbMap, setVideoThumbMap] = useState({})
  const [showScrollToLatest, setShowScrollToLatest] = useState(false)
  const [highlightedMessageKey, setHighlightedMessageKey] = useState('')
  const [checkPopup, setCheckPopup] = useState({ username: null, count: 0 })
  const [notificationPermission, setNotificationPermission] = useState(
    getNotificationPermissionState()
  )
  const [attachDropdownPos, setAttachDropdownPos] = useState({ top: 0, right: 0 })
  const lastPublishedReadAtRef = useRef({})
  const nextConversationPageRef = useRef(1)
  const loadingOlderMessagesRef = useRef(false)
  const mediaInputRef = useRef(null)
  const cameraPhotoInputRef = useRef(null)
  const cameraVideoInputRef = useRef(null)
  const fileInputRef = useRef(null)
  const messagesAreaRef = useRef(null)
  const messagesEndRef = useRef(null)
  const keyboardBottomLockRef = useRef({ rafId: 0, until: 0 })
  const shouldAutoScrollToBottomRef = useRef(true)
  const selectedUserRef = useRef(null)
  const statusMapRef = useRef({})
  const socketRef = useRef(null)
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
    offset: 0,
    moved: false,
    triggered: false,
    swiped: false,
  })
  const swipeTapSuppressUntilRef = useRef(0)
  const mediaRecorderRef = useRef(null)
  const discardRecordingRef = useRef(false)
  const recordingStreamRef = useRef(null)
  const recordingChunksRef = useRef([])
  const recordingTimerRef = useRef(null)
  const wsErrorToastAtRef = useRef(0)
  const wsResumeSuppressUntilRef = useRef(0)
  const messageInputRef = useRef(null)
  const wsLastHiddenAtRef = useRef(typeof Date !== 'undefined' ? Date.now() : 0)
  const wsErrorTimerRef = useRef(null)
  const lastAutoRefreshAtRef = useRef(0)
  const offlineSinceRef = useRef({})
  const checkOpenTimerRef = useRef(null)
  const countedCheckVisitKeyRef = useRef('')
  const readReceiptTimerRef = useRef(null)
  const maxViewportHeightRef = useRef(0)
  const keyboardSettleUntilRef = useRef(0)
  const syncKeyboardLayoutRef = useRef(() => {})
  const conversationCacheRef = useRef({})
  const messagesRef = useRef([])
  const draggedMessageRef = useRef(null)
  const lastMessageTapRef = useRef({ key: null, at: 0, count: 0, timerId: null })
  const hasOlderMessagesRef = useRef(false)
  const messageNodeMapRef = useRef({})
  const highlightClearTimerRef = useRef(null)
  const heapPressureRef = useRef({ lastUsedBytes: 0, lastRatio: 0, lastWarnAt: 0 })
  const CLEAR_CUTOFFS_KEY = 'chat_clear_cutoffs_v1'
  const USERS_CACHE_KEY_PREFIX = 'chat_users_cache_v1:'
  const CONVERSATION_CACHE_KEY_PREFIX = 'chat_conversation_cache_v1:'

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
  const getUsersCacheKey = () => `${USERS_CACHE_KEY_PREFIX}${toUserKey(flow.username)}`
  const getConversationCacheKey = (peerUsername) => `${CONVERSATION_CACHE_KEY_PREFIX}${getConversationKey(peerUsername)}`
  const isNativeCapacitorRuntime = () => {
    if (typeof window === 'undefined') return false
    const cap = window.Capacitor
    if (!cap) return false
    if (typeof cap.isNativePlatform === 'function') {
      return Boolean(cap.isNativePlatform())
    }
    const platform = cap.getPlatform?.()
    return platform === 'ios' || platform === 'android'
  }
  const isGrantedPermissionState = (value) => value === 'granted' || value === 'limited'
  const requestNativeCameraPermission = async () => {
    if (!isNativeCapacitorRuntime()) return true
    try {
      const cameraPerms = await Camera.requestPermissions({ permissions: ['camera', 'photos'] })
      const cameraGranted = isGrantedPermissionState(cameraPerms?.camera)
      const photosGranted = isGrantedPermissionState(cameraPerms?.photos)
      if (cameraGranted || photosGranted) {
        return true
      }
    } catch (error) {
      const message = String(error?.message || '').toLowerCase()
      if (message.includes('cancel')) return false
    }
    notify.error('Camera permission is required. Enable it in settings.')
    return false
  }
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
  const readUsersCache = () => {
    try {
      const raw = window.localStorage.getItem(getUsersCacheKey())
      const parsed = raw ? JSON.parse(raw) : []
      if (!Array.isArray(parsed)) return []
      return parsed
        .filter((row) => row && typeof row === 'object')
        .map((row) => ({
          id: row.id,
          username: String(row.username || '').trim(),
          name: String(row.name || '').trim(),
          status: 'offline',
          lastMessage: String(row.lastMessage || ''),
          timestamp: String(row.timestamp || ''),
          hasConversation: Boolean(row.hasConversation) || Boolean(String(row.lastMessage || '').trim()) || Boolean(String(row.timestamp || '').trim()),
          lastCreatedAt: Number(row.lastCreatedAt || 0) || 0,
        }))
        .filter((row) => row.username)
    } catch {
      return []
    }
  }
  const writeUsersCache = (rows) => {
    try {
      const serialized = (rows || [])
        .map((row) => ({
          id: row.id,
          username: row.username,
          name: row.name || '',
          lastMessage: row.lastMessage || '',
          timestamp: row.timestamp || '',
          hasConversation: Boolean(row.hasConversation) || Boolean(String(row.lastMessage || '').trim()) || Boolean(String(row.timestamp || '').trim()),
          lastCreatedAt: Number(row.lastCreatedAt || 0) || 0,
        }))
      window.localStorage.setItem(getUsersCacheKey(), JSON.stringify(serialized))
    } catch {
      // Ignore localStorage write failures.
    }
  }
  const normalizeConversationRows = (rows, clearCutoff = 0, conversationPeerUsername = '') => (rows || [])
    .filter((row) => {
      if (!clearCutoff) return true
      const createdAt = Number(row?.createdAt || row?.clientCreatedAt || 0)
      if (!createdAt) return false
      return createdAt > clearCutoff
    })
    .map((row) => {
      const createdAt = Number(row?.createdAt || row?.clientCreatedAt || 0) || null
      const peerKey = toUserKey(conversationPeerUsername)
      return {
        sender: row?.sender || 'other',
        text: row?.text || '',
        type: row?.type || null,
        fileName: row?.fileName || null,
        mediaUrl: normalizeMediaUrl(row?.mediaUrl || null),
        mediaType: row?.mediaType || row?.type || null,
        mimeType: row?.mimeType || null,
        reaction: decodeReaction(row?.reaction),
        replyingTo: row?.replyText
          ? {
              text: row.replyText,
              senderName: row.replySenderName || row.senderName,
              messageId: row.replyMessageId || null,
              type: row.replyType || null,
              mediaUrl: normalizeMediaUrl(row.replyMediaUrl || null),
              mimeType: row.replyMimeType || null,
              fileName: row.replyFileName || null,
            }
          : (row?.replyingTo || null),
        senderName: formatUsername(row?.senderName),
        peerUsername: peerKey || null,
        tempId: row?.clientMessageId || row?.tempId || null,
        messageId: row?.id || row?.messageId || null,
        createdAt,
        clientCreatedAt: createdAt,
        timestamp: formatTimestamp(createdAt),
        edited: Boolean(row?.edited || row?.isEdited),
        editedAt: Number(row?.editedAt || 0) || null,
      }
    })
  const readConversationCache = (peerUsername, clearCutoff = 0) => {
    try {
      const raw = window.localStorage.getItem(getConversationCacheKey(peerUsername))
      const parsed = raw ? JSON.parse(raw) : []
      if (!Array.isArray(parsed)) return []
      return normalizeConversationRows(parsed, clearCutoff, peerUsername)
    } catch {
      return []
    }
  }
  const writeConversationCache = (peerUsername, rows) => {
    try {
      const snapshot = (rows || [])
        .filter((row) => row?.messageId || row?.createdAt)
        .slice(-220)
        .map((row) => ({
          messageId: row.messageId || null,
          clientMessageId: row.tempId || null,
          sender: row.sender || 'other',
          senderName: row.senderName || '',
          text: row.text || '',
          type: row.type || null,
          fileName: row.fileName || null,
          mediaUrl: row.mediaUrl || null,
          mediaType: row.mediaType || row.type || null,
          mimeType: row.mimeType || null,
          reaction: row.reaction || null,
          replyingTo: row.replyingTo || null,
          createdAt: Number(row.createdAt || row.clientCreatedAt || 0) || null,
          edited: Boolean(row.edited),
          editedAt: Number(row.editedAt || 0) || null,
        }))
      window.localStorage.setItem(getConversationCacheKey(peerUsername), JSON.stringify(snapshot))
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
    edit: '\u270E',
    copy: '\u2398',
    resend: '\u21BB',
    send: '\u27A4',
    cancel: '\u2716',
    game: '\uD83C\uDFAE',
  }
  const getTypeIcon = (type) => {
    if (type === 'image') return icons.image
    if (type === 'video') return icons.video
    if (type === 'file') return icons.file
    if (type === 'voice') return icons.voice
    return ''
  }
  const DeleteActionIcon = () => (
    <svg className="delete-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="11" />
      <path d="M15.8 8.2h-1V7.6c0-1-0.8-1.8-1.8-1.8h-2c-1 0-1.8 0.8-1.8 1.8v0.6h-1c-0.4 0-0.8 0.3-0.8 0.8s0.3 0.8 0.8 0.8h0.2v6.5c0 1.1 0.9 2 2 2h3.2c1.1 0 2-0.9 2-2V9.7h0.2c0.4 0 0.8-0.3 0.8-0.8s-0.4-0.7-0.8-0.7Zm-5-0.6v-0.4c0-0.2 0.2-0.4 0.4-0.4h1.7c0.2 0 0.4 0.2 0.4 0.4v0.4h-2.5Z" />
      <path d="M10.2 11.1c0-0.4-0.3-0.8-0.8-0.8s-0.8 0.3-0.8 0.8v4.1c0 0.4 0.3 0.8 0.8 0.8s0.8-0.3 0.8-0.8v-4.1Zm2.6 0c0-0.4-0.3-0.8-0.8-0.8s-0.8 0.3-0.8 0.8v4.1c0 0.4 0.3 0.8 0.8 0.8s0.8-0.3 0.8-0.8v-4.1Zm2.6 0c0-0.4-0.3-0.8-0.8-0.8s-0.8 0.3-0.8 0.8v4.1c0 0.4 0.3 0.8 0.8 0.8s0.8-0.3 0.8-0.8v-4.1Z" />
    </svg>
  )
  const VoiceActionIcon = ({ className = '' }) => (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a1 1 0 1 1 2 0 7 7 0 0 1-6 6.92V21h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-3.08A7 7 0 0 1 5 11a1 1 0 0 1 2 0 5 5 0 0 0 10 0Z"
      />
    </svg>
  )
  const formatTimestamp = (value) => {
    if (!value) return getTimeLabel()
    return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  const triggerFileDownload = async (url, suggestedName) => {
    const safeUrl = String(url || '').trim()
    if (!safeUrl) return
    const downloadName = String(suggestedName || 'attachment').trim() || 'attachment'
    if (isNativeCapacitorRuntime()) {
      try {
        const response = await fetch(safeUrl)
        if (!response.ok) throw new Error(`open-file-fetch-failed-${response.status}`)
        const blob = await response.blob()
        const mimeType = String(blob?.type || response.headers.get('content-type') || 'application/octet-stream').trim() || 'application/octet-stream'
        const toBase64 = (blobValue) => new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onloadend = () => {
            const result = String(reader.result || '')
            const base64Data = result.split(',').pop() || ''
            if (!base64Data) {
              reject(new Error('open-file-base64-empty'))
              return
            }
            resolve(base64Data)
          }
          reader.onerror = () => reject(reader.error || new Error('open-file-base64-failed'))
          reader.readAsDataURL(blobValue)
        })

        const safeName = downloadName.replace(/[^\w.\-() ]+/g, '_')
        const cachePath = `chat-files/${Date.now()}-${safeName}`
        const base64Data = await toBase64(blob)
        await Filesystem.mkdir({
          path: 'chat-files',
          directory: Directory.Cache,
          recursive: true,
        }).catch(() => {})
        const saved = await Filesystem.writeFile({
          path: cachePath,
          data: base64Data,
          directory: Directory.Cache,
          recursive: true,
        })
        let nativePath = String(saved?.uri || '').trim()
        if (!nativePath) {
          const fallbackUri = await Filesystem.getUri({
            path: cachePath,
            directory: Directory.Cache,
          })
          nativePath = String(fallbackUri?.uri || '').trim()
        }
        await OpenFile.openFile({
          path: nativePath,
          mimeType,
          title: 'Open file with',
        })
        return
      } catch {
        notify.error('Unable to open file.')
        return
      }
    }
    try {
      const response = await fetch(safeUrl)
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
      window.open(safeUrl, '_blank', 'noopener,noreferrer')
    }
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
  const isSecretTapMessageType = (messageType) => String(messageType || '').trim().toLowerCase() === SECRET_TAP_TYPE
  const getMessagePreview = (messageType, textValue, fileNameValue) => {
    if (isSecretTapMessageType(messageType)) return ''
    if (messageType === 'image') return 'Sent an image'
    if (messageType === 'video') return 'Sent a video'
    if (messageType === 'voice') return 'Sent a voice message'
    if (messageType === 'file') return fileNameValue ? `Sent file: ${fileNameValue}` : 'Sent a file'
    return textValue || 'New message'
  }
  const getNotificationPreview = (messageType, textValue, fileNameValue, viewerUsername) => {
    if (isSecretTapMessageType(messageType)) {
      return toUserKey(viewerUsername) === TONY_USERNAME ? (textValue || 'New message') : 'New message'
    }
    return getMessagePreview(messageType, textValue, fileNameValue)
  }
  const toReplyText = (reply) => {
    if (!reply) return ''
    const raw = String(reply.text || '').trim()
    if (raw) return raw
    return getMessagePreview(reply.type || null, '', reply.fileName || null)
  }
  const buildReplyPayload = (reply) => {
    if (!reply) return null
    return {
      text: toReplyText(reply),
      senderName: reply.senderName || '',
      messageId: reply.messageId || null,
      type: reply.type || null,
      mediaUrl: normalizeMediaUrl(reply.mediaUrl || null),
      mimeType: reply.mimeType || null,
      fileName: reply.fileName || null,
    }
  }
  const summarizeConversationForList = (rows) => {
    if (!Array.isArray(rows) || !rows.length) {
      return {
        hasConversation: false,
        lastMessage: '',
        timestamp: '',
        lastCreatedAt: 0,
      }
    }
    const visibleRows = rows.filter((row) => !isSecretTapMessageType(row?.type))
    if (!visibleRows.length) {
      return {
        hasConversation: rows.length > 0,
        lastMessage: '',
        timestamp: '',
        lastCreatedAt: 0,
      }
    }
    let latest = visibleRows[visibleRows.length - 1]
    let latestCreatedAt = Number(latest?.createdAt || latest?.clientCreatedAt || 0)
    for (const row of visibleRows) {
      const createdAt = Number(row?.createdAt || row?.clientCreatedAt || 0)
      if (createdAt >= latestCreatedAt) {
        latest = row
        latestCreatedAt = createdAt
      }
    }
    const preview = getMessagePreview(
      latest?.type || null,
      latest?.text || latest?.message || '',
      latest?.fileName || null
    )
    return {
      hasConversation: true,
      lastMessage: String(preview || 'Conversation started').trim() || 'Conversation started',
      timestamp: latestCreatedAt
        ? formatTimestamp(latestCreatedAt)
        : String(latest?.timestamp || '').trim(),
      lastCreatedAt: latestCreatedAt || Date.now(),
    }
  }
  const summarizeServerConversationSummary = (row) => {
    const createdAt = Number(row?.createdAt || 0) || 0
    if (!createdAt && !String(row?.text || '').trim() && !String(row?.type || '').trim()) {
      return {
        hasConversation: false,
        lastMessage: '',
        timestamp: '',
        lastCreatedAt: 0,
      }
    }
    if (isSecretTapMessageType(row?.type)) {
      return {
        hasConversation: true,
        lastMessage: '',
        timestamp: '',
        lastCreatedAt: 0,
      }
    }
    return {
      hasConversation: true,
      lastMessage: getMessagePreview(row?.type || null, row?.text || '', row?.fileName || null),
      timestamp: createdAt ? formatTimestamp(createdAt) : '',
      lastCreatedAt: createdAt || 0,
    }
  }
  const getMissedIncomingSince = async (token, peerUsername, cutoff) => {
    const cutoffMs = Number(cutoff || 0)
    let page = 0
    let hasMore = true
    let missedCount = 0
    let latestIncomingAt = 0

    while (hasMore && page < MISSED_SCAN_PAGE_LIMIT) {
      const pageResult = await getConversation(token, peerUsername, { page, size: CONVERSATION_PAGE_SIZE })
      const rows = Array.isArray(pageResult?.messages) ? pageResult.messages : []
      const incomingRows = rows
        .filter((row) => row?.sender === 'other' && !isSecretTapMessageType(row?.type))
        .map((row) => Number(row?.createdAt || 0))
        .filter((value) => value > 0)

      if (incomingRows.length) {
        const newestInPage = Math.max(...incomingRows)
        const oldestInPage = Math.min(...incomingRows)
        if (newestInPage > latestIncomingAt) latestIncomingAt = newestInPage
        const newerInPage = incomingRows.filter((value) => value > cutoffMs).length
        missedCount += newerInPage
        hasMore = Boolean(pageResult?.hasMore)
        if (!hasMore || oldestInPage <= cutoffMs) break
      } else {
        hasMore = Boolean(pageResult?.hasMore)
        if (!hasMore) break
      }

      page += 1
    }

    return { count: missedCount, latestIncomingAt }
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
  const isMessageQueued = (message) => message?.deliveryStatus === 'queued'
  const isMessageRetryable = (message) => isMessageFailed(message) || isMessageQueued(message)
  const getMessageEditKey = (message) => {
    if (!message) return ''
    if (message.messageId) return `id:${message.messageId}`
    if (message.tempId) return `temp:${message.tempId}`
    const created = getMessageCreatedAtMs(message)
    return `local:${message.sender || 'x'}:${created}:${message.senderName || ''}`
  }
  const isSameMessage = (message, key) => getMessageEditKey(message) === key
  const getMessageUiKey = (message, index) => getMessageEditKey(message) || `${index}-${message?.createdAt || message?.timestamp || 'x'}-${message?.sender || 'u'}`
  const setMessageNodeRef = (messageKey, node) => {
    if (!messageKey) return
    if (node) {
      messageNodeMapRef.current[messageKey] = node
      return
    }
    delete messageNodeMapRef.current[messageKey]
  }
  const getDistanceFromLatest = () => {
    const listEl = messagesAreaRef.current
    if (listEl) {
      const top = Number(listEl.scrollTop || 0)
      const height = Number(listEl.clientHeight || 0)
      const full = Number(listEl.scrollHeight || 0)
      const listDistance = Math.max(0, full - (top + height))
      if (full > height + 8) {
        return listDistance
      }
    }
    if (typeof window === 'undefined') return 0
    const doc = window.document?.documentElement
    const full = Number(doc?.scrollHeight || 0)
    const top = Number(window.scrollY || window.pageYOffset || 0)
    const height = Number(window.innerHeight || 0)
    return Math.max(0, full - (top + height))
  }
  const updateScrollToLatestVisibility = () => {
    const distanceFromBottom = getDistanceFromLatest()
    setShowScrollToLatest(distanceFromBottom > AUTO_SCROLL_BOTTOM_THRESHOLD)
  }
  const findReplyTargetKey = (reply) => {
    if (!reply) return ''
    const targetMessageId = Number(reply.messageId || 0)
    const replyText = String(reply.text || '').trim()
    const replyType = String(reply.type || 'text').trim().toLowerCase()
    const replyMediaUrl = normalizeMediaUrl(reply.mediaUrl || null)
    const replyFileName = String(reply.fileName || '').trim()
    const replySenderName = toUserKey(reply.senderName || '')
    const hasReplyMedia = Boolean(replyMediaUrl)
    const hasReplyFileName = Boolean(replyFileName)
    const hasReplyText = Boolean(replyText)
    let textOnlyFallbackKey = ''
    let senderTextFallbackKey = ''
    for (let index = messagesRef.current.length - 1; index >= 0; index -= 1) {
      const message = messagesRef.current[index]
      if (!message) continue
      if (targetMessageId > 0 && Number(message.messageId || 0) === targetMessageId) {
        return getMessageUiKey(message, index)
      }
      const messageType = String(message.type || 'text').trim().toLowerCase()
      const sameType = messageType === replyType
      const sameMedia = normalizeMediaUrl(message.mediaUrl || null) === replyMediaUrl
      const sameFile = String(message.fileName || '').trim() === replyFileName
      const sameText = String(message.text || '').trim() === replyText
      const sameSender = toUserKey(message.senderName || '') === replySenderName
      const mediaMatch = hasReplyMedia && sameType && sameMedia
      const fileMatch = hasReplyFileName && sameType && sameFile
      const textMatch = hasReplyText && sameText
      if (sameSender && (mediaMatch || fileMatch || textMatch)) {
        return getMessageUiKey(message, index)
      }
      if (!senderTextFallbackKey && hasReplyText && sameText && sameSender) {
        senderTextFallbackKey = getMessageUiKey(message, index)
      }
      if (!textOnlyFallbackKey && hasReplyText && sameText) {
        textOnlyFallbackKey = getMessageUiKey(message, index)
      }
    }
    return senderTextFallbackKey || textOnlyFallbackKey || ''
  }
  const highlightMessageKey = (messageKey) => {
    if (!messageKey) return
    if (highlightClearTimerRef.current) {
      clearTimeout(highlightClearTimerRef.current)
    }
    setHighlightedMessageKey(messageKey)
    highlightClearTimerRef.current = setTimeout(() => {
      setHighlightedMessageKey((current) => (current === messageKey ? '' : current))
      highlightClearTimerRef.current = null
    }, 1800)
  }
  const scrollToMessageKey = (messageKey, behavior = 'smooth') => {
    if (!messageKey) return false
    const node = messageNodeMapRef.current[messageKey]
    if (!node) return false
    try {
      node.scrollIntoView({ behavior, block: 'center' })
    } catch {
      node.scrollIntoView()
    }
    highlightMessageKey(messageKey)
    return true
  }
  const prependOlderMessages = (olderRows, currentRows) => {
    if (!Array.isArray(olderRows) || !olderRows.length) return currentRows || []
    if (!Array.isArray(currentRows) || !currentRows.length) return olderRows

    const seenIds = new Set(
      currentRows
        .map((row) => Number(row?.messageId || 0))
        .filter((id) => id > 0)
    )

    const filteredOlderRows = olderRows.filter((row) => {
      const rowId = Number(row?.messageId || 0)
      if (rowId > 0) return !seenIds.has(rowId)
      const rowCreatedAt = Number(row?.createdAt || row?.clientCreatedAt || 0)
      return !currentRows.some((existing) => {
        const existingId = Number(existing?.messageId || 0)
        if (existingId > 0) return false
        return (
          Number(existing?.createdAt || existing?.clientCreatedAt || 0) === rowCreatedAt &&
          String(existing?.sender || '') === String(row?.sender || '') &&
          String(existing?.text || '') === String(row?.text || '') &&
          String(existing?.mediaUrl || '') === String(row?.mediaUrl || '')
        )
      })
    })

    if (!filteredOlderRows.length) return currentRows
    return [...filteredOlderRows, ...currentRows]
  }
  const syncConversationSummaryForUser = (peerUsername, nextRows) => {
    const normalizedPeer = String(peerUsername || '').trim()
    if (!normalizedPeer) return
    const peerKey = toUserKey(normalizedPeer)
    const stableRows = (nextRows || []).filter((row) => (
      row?.deliveryStatus !== 'uploading' && row?.deliveryStatus !== 'queued' && row?.deliveryStatus !== 'failed'
    ))
    conversationCacheRef.current[peerKey] = stableRows
    writeConversationCache(normalizedPeer, stableRows)
    const summary = summarizeConversationForList(stableRows)
    setUsers((prev) => prev.map((user) => (
      toUserKey(user.username) === peerKey
        ? { ...user, ...summary }
        : user
    )))
  }
  const canEditMessage = (message) => {
    if (!message || message.sender !== 'user') return false
    if (isMessageRetryable(message)) return false
    if (message.type && message.type !== 'text') return false
    if (!message.messageId) return false
    const createdAt = getMessageCreatedAtMs(message)
    if (!createdAt) return false
    return (Date.now() - createdAt) <= EDIT_WINDOW_MS
  }
  const getMessageFooterLabel = (message) => {
    if (isMessageFailed(message)) return `Not sent · ${message.timestamp}`
    if (isMessageQueued(message)) return `Queued · reconnecting · ${message.timestamp}`
    if (message?.deliveryStatus === 'uploading') {
      const progress = Math.max(0, Math.min(100, Number(message?.uploadProgress || 0)))
      const rounded = Math.round(progress)
      if (message?.uploadPhase === 'compressing') return `Compressing ${rounded}% · ${message.timestamp}`
      if (message?.uploadPhase === 'uploading') return `Uploading ${rounded}% · ${message.timestamp}`
      return `Sending... · ${message.timestamp}`
    }
    if (message?.edited) return `edited · ${message.timestamp}`
    return message?.timestamp || getTimeLabel()
  }
  const createTempId = () => (window.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`)
  
  // Trim old messages to save RAM - keep only latest MAX_MESSAGES_IN_MEMORY
  const trimMessageHistory = (messageList) => {
    if (!Array.isArray(messageList) || messageList.length <= MAX_MESSAGES_IN_MEMORY) {
      return messageList
    }
    const excessCount = messageList.length - MAX_MESSAGES_IN_MEMORY
    return messageList.slice(excessCount)
  }
  
  const isSameIncomingMessage = (left, right) => {
    if (!left || !right) return false
    const leftId = Number(left.messageId || 0)
    const rightId = Number(right.messageId || 0)
    if (leftId > 0 && rightId > 0) return leftId === rightId
    const leftTempId = String(left.tempId || '').trim()
    const rightTempId = String(right.tempId || '').trim()
    if (leftTempId && rightTempId) return leftTempId === rightTempId

    const leftCreatedAt = Number(left.createdAt || left.clientCreatedAt || 0)
    const rightCreatedAt = Number(right.createdAt || right.clientCreatedAt || 0)
    const closeInTime = leftCreatedAt > 0 && rightCreatedAt > 0 && Math.abs(leftCreatedAt - rightCreatedAt) <= 2000
    const sameSender = (left.sender || '') === (right.sender || '') && (left.senderName || '') === (right.senderName || '')
    const sameType = (left.type || '') === (right.type || '')
    const sameText = (left.text || '') === (right.text || '')
    const sameMedia = (left.mediaUrl || '') === (right.mediaUrl || '') && (left.fileName || '') === (right.fileName || '')
    return sameSender && sameType && sameText && sameMedia && closeInTime
  }
  const copyTextToClipboard = async (value) => {
    const text = String(value || '').trim()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      notify.success('Copied')
    } catch {
      notify.error('Copy failed')
    }
  }
  const MAX_MEDIA_BYTES = 12 * 1024 * 1024
  const MAX_MEDIA_MB = Math.max(1, Math.round(MAX_MEDIA_BYTES / (1024 * 1024)))
  const HEAP_PRESSURE_CHECK_MS = 20000
  const HEAP_PRESSURE_WARN_RATIO = 0.82
  const HEAP_PRESSURE_CRITICAL_RATIO = 0.9
  const HEAP_PRESSURE_MIN_GROWTH_BYTES = 12 * 1024 * 1024
  const HEAP_PRESSURE_WARN_COOLDOWN_MS = 120000
  const inferMediaKind = (inputFile) => {
    const mime = (inputFile?.type || '').toLowerCase()
    const name = (inputFile?.name || '').toLowerCase()
    if (mime.startsWith('video/')) return 'video'
    if (mime.startsWith('image/')) return 'image'
    if (/\.(mp4|mov|qt|m4v|webm|mkv|avi|3gp|3g2)$/i.test(name)) return 'video'
    if (/\.(jpg|jpeg|png|gif|webp|heic|heics|heif|heifs|hif|bmp|svg)$/i.test(name)) return 'image'
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
  const compressImageToLimit = async (inputFile, maxBytes, onProgress) => {
    if (typeof window === 'undefined') return null
    const reportProgress = (value) => {
      if (typeof onProgress !== 'function') return
      const safeValue = Math.max(0, Math.min(100, Math.round(Number(value || 0))))
      onProgress(safeValue)
    }
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
      const totalSteps = 6 * qualitySteps.length
      let completedSteps = 0
      let bestBlob = null
      reportProgress(1)

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
          completedSteps += 1
          reportProgress((completedSteps / totalSteps) * 100)
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
        reportProgress(100)
        const outputName = (inputFile.name || 'image').replace(/\.[^.]+$/, '') + '.jpg'
        return new File([bestBlob], outputName, {
          type: 'image/jpeg',
          lastModified: Date.now(),
        })
      }
      reportProgress(100)
      return null
    } catch {
      reportProgress(100)
      return null
    }
  }
  const compressMediaToLimit = async (inputFile, mediaType, maxBytes, onProgress) => {
    const reportProgress = (value) => {
      if (typeof onProgress !== 'function') return
      const safeValue = Math.max(0, Math.min(100, Math.round(Number(value || 0))))
      onProgress(safeValue)
    }
    if (!inputFile || inputFile.size <= maxBytes) {
      reportProgress(100)
      return { file: inputFile, compressed: false }
    }

    if (mediaType === 'image') {
      const imageCompressed = await compressImageToLimit(inputFile, maxBytes, (value) => {
        const mapped = 5 + ((Math.max(0, Math.min(100, value)) / 100) * 80)
        reportProgress(mapped)
      })
      if (imageCompressed && imageCompressed.size <= maxBytes) {
        reportProgress(100)
        return { file: imageCompressed, compressed: true }
      }
      reportProgress(85)
      const gzipCompressed = await gzipFile(inputFile)
      reportProgress(100)
      if (gzipCompressed && gzipCompressed.size <= maxBytes) {
        return { file: gzipCompressed, compressed: true }
      }
      return null
    }

    reportProgress(20)
    const gzipCompressed = await gzipFile(inputFile)
    reportProgress(100)
    if (gzipCompressed && gzipCompressed.size <= maxBytes) {
      return { file: gzipCompressed, compressed: true }
    }
    return null
  }
  const formatLastOnlineTime = (lastSeenAt) => {
    const timestamp = Number(lastSeenAt || 0)
    if (!timestamp) return null
    return new Date(timestamp).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).toLowerCase()
  }
  const toShortLastSeen = (lastSeenAt) => {
    const formatted = formatLastOnlineTime(lastSeenAt)
    return formatted || '-'
  }
  const toLongLastSeen = (lastSeenAt) => {
    const formatted = formatLastOnlineTime(lastSeenAt)
    return formatted ? `last online at ${formatted}` : 'offline'
  }
  const getPresence = (username, fallback = 'offline') => {
    const userKey = toUserKey(username)
    const cachedLastSeenAt = Number(presenceLastSeenMap[userKey] || 0) || null
    const current = statusMap[userKey]
    if (current) {
      const normalizedStatus = String(current.status || '').trim().toLowerCase() || fallback
      return {
        ...current,
        status: normalizedStatus,
        lastSeenAt: current.lastSeenAt || cachedLastSeenAt,
      }
    }
    return { status: fallback, lastSeenAt: cachedLastSeenAt }
  }
  const getResolvedPresence = (username, fallback = 'offline') => {
    const presence = getPresence(username, fallback)
    const lastSeenAt = Number(presence.lastSeenAt || 0) || null
    if (presence.status === 'online') {
      delete offlineSinceRef.current[username]
      return presence
    }
    if (lastSeenAt) {
      offlineSinceRef.current[username] = lastSeenAt
      return { status: presence.status, lastSeenAt }
    }
    return presence
  }
  const selectedPresence = selectedUser ? getResolvedPresence(selectedUser.username, 'offline') : { status: 'offline', lastSeenAt: null }
  const selectedTyping = selectedUser ? Boolean(typingMap[toUserKey(selectedUser.username)]) : false
  const getLastOutgoingAt = (peerUsername) => {
    if (!peerUsername) return 0
    let latest = 0
    for (const msg of messages) {
      if (msg?.sender !== 'user') continue
      if (msg?.deliveryStatus === 'failed' || msg?.deliveryStatus === 'queued' || msg?.deliveryStatus === 'uploading') continue
      const createdAt = Number(msg?.createdAt || 0)
      if (createdAt > latest) latest = createdAt
    }
    return latest
  }
  const selectedLastOutgoingAt = selectedUser ? getLastOutgoingAt(selectedUser.username) : 0
  const selectedSeen = selectedUser
    ? Number(seenAtMap[(selectedUser.username || '').toLowerCase()] || 0) >= selectedLastOutgoingAt && selectedLastOutgoingAt > 0
    : false
  const localTodayMessages = useMemo(() => {
    const now = new Date()
    const targetYear = now.getFullYear()
    const targetMonth = now.getMonth()
    const targetDay = now.getDate()
    let count = 0

    for (const msg of messages) {
      if (!msg) continue
      if (msg.deliveryStatus === 'uploading' || msg.deliveryStatus === 'queued' || msg.deliveryStatus === 'failed') continue
      let createdAtMs = Number(msg?.createdAt || msg?.clientCreatedAt || 0)
      if (!createdAtMs) continue
      if (createdAtMs > 0 && createdAtMs < 1_000_000_000_000) {
        createdAtMs *= 1000
      }
      const date = new Date(createdAtMs)
      if (Number.isNaN(date.getTime())) continue
      if (
        date.getFullYear() === targetYear &&
        date.getMonth() === targetMonth &&
        date.getDate() === targetDay
      ) {
        count += 1
      }
    }

    return count
  }, [messages])
  const apiTodayMessages = Math.max(0, Number(headerStats?.todayMessages || 0))
  const effectiveTodayMessages = Math.max(apiTodayMessages, localTodayMessages)
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
    messagesRef.current = messages || []
  }, [messages])

  useEffect(() => {
    hasOlderMessagesRef.current = Boolean(hasOlderMessages)
  }, [hasOlderMessages])

  useEffect(() => {
    statusMapRef.current = statusMap || {}
  }, [statusMap])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const supportsHeapTelemetry = Boolean(
      window.performance?.memory
      && Number(window.performance.memory.jsHeapSizeLimit || 0) > 0
    )
    if (!supportsHeapTelemetry) return undefined

    const checkHeapPressure = () => {
      if (document.visibilityState === 'hidden') return
      const memory = window.performance?.memory
      const usedBytes = Number(memory?.usedJSHeapSize || 0)
      const heapLimitBytes = Number(memory?.jsHeapSizeLimit || 0)
      if (!usedBytes || !heapLimitBytes) return

      const currentRatio = usedBytes / heapLimitBytes
      const previous = heapPressureRef.current || { lastUsedBytes: 0, lastRatio: 0, lastWarnAt: 0 }
      const growthBytes = usedBytes - Number(previous.lastUsedBytes || 0)
      const ratioGrowth = currentRatio - Number(previous.lastRatio || 0)
      const now = Date.now()
      const isGrowing = ratioGrowth >= 0.02 || growthBytes >= HEAP_PRESSURE_MIN_GROWTH_BYTES
      const aboveWarn = currentRatio >= HEAP_PRESSURE_WARN_RATIO
      const cooldownPassed = (now - Number(previous.lastWarnAt || 0)) >= HEAP_PRESSURE_WARN_COOLDOWN_MS

      if (aboveWarn && isGrowing && cooldownPassed) {
        const usedMb = Math.round(usedBytes / (1024 * 1024))
        const limitMb = Math.round(heapLimitBytes / (1024 * 1024))
        const usagePercent = Math.round(currentRatio * 100)
        const growthMb = Math.max(0, Math.round(growthBytes / (1024 * 1024)))
        const isCritical = currentRatio >= HEAP_PRESSURE_CRITICAL_RATIO
        toast.warn(
          isCritical
            ? `RAM pressure critical: ${usagePercent}% (${usedMb}/${limitMb}MB).`
            : `RAM pressure rising: ${usagePercent}% (${usedMb}/${limitMb}MB, +${growthMb}MB).`,
          {
            toastId: 'chat-heap-pressure',
            autoClose: isCritical ? 9000 : 6500,
          }
        )
        heapPressureRef.current = {
          lastUsedBytes: usedBytes,
          lastRatio: currentRatio,
          lastWarnAt: now,
        }
        return
      }

      heapPressureRef.current = {
        ...previous,
        lastUsedBytes: usedBytes,
        lastRatio: currentRatio,
      }
    }

    const intervalId = window.setInterval(checkHeapPressure, HEAP_PRESSURE_CHECK_MS)
    checkHeapPressure()
    return () => window.clearInterval(intervalId)
  }, [])

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
    let disposed = false

    const syncNativeChatPageState = async () => {
      try {
        const shouldMarkActive = (
          getNormalizedRoutePath(location).startsWith('/chat') &&
          document.visibilityState === 'visible' &&
          Boolean(selectedUserRef.current?.username)
        )
        await Preferences.set({ key: NATIVE_CHAT_PAGE_ACTIVE_KEY, value: shouldMarkActive ? '1' : '0' })
      } catch {
        // Ignore native preference sync failures.
      }
    }

    void syncNativeChatPageState()

    const onVisibilityChange = () => {
      if (disposed) return
      void syncNativeChatPageState()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      void Preferences.set({ key: NATIVE_CHAT_PAGE_ACTIVE_KEY, value: '0' }).catch(() => {})
    }
  }, [location.pathname, location.hash, selectedUser?.username])

  useEffect(() => {
    setEditingMessage(null)
  }, [selectedUser?.username])

  useEffect(() => {
    if (!flow?.token || !selectedUser?.username) {
      setHeaderStats({ todayMessages: 0, yesterdayMessages: 0, dailyAverage: 0 })
      return
    }

    let cancelled = false
    const loadHeaderStats = async () => {
      try {
        const data = await getChatStats(flow.token, selectedUser.username)
        if (cancelled || !data) return
        setHeaderStats({
          todayMessages: Number(data?.todayMessages || 0),
          yesterdayMessages: Number(data?.yesterdayMessages || 0),
          dailyAverage: Number(data?.dailyAverage || 0),
        })
      } catch {
        if (cancelled) return
        setHeaderStats({ todayMessages: 0, yesterdayMessages: 0, dailyAverage: 0 })
      }
    }

    loadHeaderStats()
    return () => {
      cancelled = true
    }
  }, [flow?.token, selectedUser?.username, lastSentMessageId])

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
    const isAndroid = platform === 'android'
    setIsIosPlatform(isiOS)
    setIsAndroidPlatform(isAndroid)
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return

    const handleSelectStart = (event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (!target.closest('.messages-area .message-content')) return
      if (target.closest('input, textarea, button, a, audio, video')) return
      event.preventDefault()
    }

    document.addEventListener('selectstart', handleSelectStart)
    return () => {
      document.removeEventListener('selectstart', handleSelectStart)
    }
  }, [])

  useEffect(() => {
    if (!isNativeCapacitorRuntime()) return
    const t1 = setTimeout(() => window.dispatchEvent(new Event('resize')), 100)
    const t2 = setTimeout(() => window.dispatchEvent(new Event('resize')), 350)
    const t3 = setTimeout(() => window.dispatchEvent(new Event('resize')), 700)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
    }
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    if (!isMobileView) return undefined
    const shouldLockDocumentViewport = isNativeCapacitorRuntime() || isIosPlatform
    if (!shouldLockDocumentViewport) return undefined
    const html = document.documentElement
    const body = document.body
    const root = document.getElementById('root')
    const lockScrollY = typeof window !== 'undefined' ? window.scrollY : 0
    const prev = {
      htmlOverflow: html.style.overflow,
      htmlHeight: html.style.height,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      bodyWidth: body.style.width,
      bodyOverflow: body.style.overflow,
      bodyHeight: body.style.height,
      rootOverflow: root?.style.overflow || '',
      rootHeight: root?.style.height || '',
    }
    html.style.overflow = 'hidden'
    html.style.height = '100%'
    body.style.position = 'fixed'
    body.style.top = `-${lockScrollY}px`
    body.style.left = '0'
    body.style.right = '0'
    body.style.width = '100%'
    body.style.overflow = 'hidden'
    body.style.height = '100%'
    if (root) {
      root.style.overflow = 'hidden'
      root.style.height = '100%'
    }
    return () => {
      html.style.overflow = prev.htmlOverflow
      html.style.height = prev.htmlHeight
      body.style.position = prev.bodyPosition
      body.style.top = prev.bodyTop
      body.style.left = prev.bodyLeft
      body.style.right = prev.bodyRight
      body.style.width = prev.bodyWidth
      body.style.overflow = prev.bodyOverflow
      body.style.height = prev.bodyHeight
      if (root) {
        root.style.overflow = prev.rootOverflow
        root.style.height = prev.rootHeight
      }
      if (typeof window !== 'undefined') {
        window.scrollTo(0, lockScrollY)
      }
    }
  }, [isMobileView, isIosPlatform])

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

    const isMessageInputFocused = () => {
      const active = document.activeElement
      return active instanceof HTMLElement && Boolean(active.closest('.message-input'))
    }

    const getKeyboardOffset = () => {
      if (isIosPlatform || isAndroidPlatform) return 0
      const viewport = window.visualViewport
      const effectiveHeight = Math.round(viewport?.height || window.innerHeight || 0)

      if (effectiveHeight > maxViewportHeightRef.current) {
        maxViewportHeightRef.current = effectiveHeight
      }
      const baseline = maxViewportHeightRef.current || effectiveHeight
      const offset = Math.max(0, baseline - effectiveHeight)
      return offset > 40 ? offset : 0
    }

    const syncKeyboardFromViewport = () => {
      const viewport = window.visualViewport
      const fallbackHeightNow = getViewportFallbackHeight()
      const rawViewportHeight = Math.round(viewport?.height || window.innerHeight || 0)
      let viewportHeightNow = rawViewportHeight > 0 ? rawViewportHeight : fallbackHeightNow
      const viewportTopNow = Math.max(0, Math.round(viewport?.offsetTop || 0))
      const nativeRuntime = isNativeCapacitorRuntime()
      const inputFocused = isMessageInputFocused()
      if (!inputFocused && fallbackHeightNow > 0 && viewportHeightNow < Math.round(fallbackHeightNow * 0.72)) {
        viewportHeightNow = fallbackHeightNow
      }
      if (nativeRuntime && isAndroidPlatform) {
        setViewportHeight((prev) => {
          const next = viewportHeightNow || fallbackHeightNow
          return Math.abs((prev || 0) - next) <= 2 ? prev : next
        })
        setVisualViewportTop(0)
        setVisualViewportBottomGap(0)
        return
      }
      const settleWindowActive = Date.now() < Number(keyboardSettleUntilRef.current || 0)
      if (viewportHeightNow > maxViewportHeightRef.current) {
        maxViewportHeightRef.current = viewportHeightNow
      }
      const baselineHeight = Math.max(maxViewportHeightRef.current || 0, viewportHeightNow)
      const layoutHeight = Math.max(
        Math.round(window.innerHeight || 0),
        fallbackHeightNow,
        viewportHeightNow,
      )
      const viewportBottomGap = Math.max(0, layoutHeight - (viewportTopNow + viewportHeightNow))
      const keyboardDelta = Math.max(0, baselineHeight - viewportHeightNow)
      const keyboardLikelyOpen = keyboardDelta > 120 || viewportBottomGap > 80
      setViewportHeight((prev) => {
        const next = viewportHeightNow || fallbackHeightNow
        return Math.abs((prev || 0) - next) <= 2 ? prev : next
      })
      setVisualViewportTop((prev) => (Math.abs((prev || 0) - viewportTopNow) <= 1 ? prev : viewportTopNow))
      setVisualViewportBottomGap((prev) => (Math.abs((prev || 0) - viewportBottomGap) <= 1 ? prev : viewportBottomGap))
      if (isAndroidPlatform) {
        setKeyboardOffset(0)
        if (settleWindowActive && inputFocused && !keyboardLikelyOpen) return
        setIsKeyboardOpen(keyboardLikelyOpen)
        return
      }
      if (!isIosPlatform) {
        const offset = getKeyboardOffset()
        setKeyboardOffset((prev) => (Math.abs((prev || 0) - offset) <= 2 ? prev : offset))
        if (settleWindowActive && inputFocused && offset <= 0 && !keyboardLikelyOpen) return
        setIsKeyboardOpen(offset > 0 || keyboardLikelyOpen)
        return
      }
      setKeyboardOffset(0)
      if (settleWindowActive && inputFocused && !keyboardLikelyOpen) return
      setIsKeyboardOpen(keyboardLikelyOpen)
    }

    let syncRafId = 0
    const queueSyncKeyboardFromViewport = () => {
      if (syncRafId) cancelAnimationFrame(syncRafId)
      syncRafId = requestAnimationFrame(() => {
        syncRafId = 0
        syncKeyboardFromViewport()
      })
    }
    syncKeyboardLayoutRef.current = queueSyncKeyboardFromViewport

    const onFocusIn = (event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (!target.closest('.message-input')) return
      keyboardSettleUntilRef.current = Date.now() + 520
      queueSyncKeyboardFromViewport()
      setTimeout(queueSyncKeyboardFromViewport, 220)
    }

    const onFocusOut = (event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (!target.closest('.message-input')) return
      keyboardSettleUntilRef.current = Date.now() + 200
      setTimeout(queueSyncKeyboardFromViewport, 60)
      setTimeout(queueSyncKeyboardFromViewport, 260)
    }

    window.addEventListener('focusin', onFocusIn)
    window.addEventListener('focusout', onFocusOut)

    const viewport = window.visualViewport
    viewport?.addEventListener('resize', queueSyncKeyboardFromViewport)
    viewport?.addEventListener('scroll', queueSyncKeyboardFromViewport)
    window.addEventListener('resize', queueSyncKeyboardFromViewport)
    window.addEventListener('orientationchange', queueSyncKeyboardFromViewport)

    let isCancelled = false
    const handles = []
    const setupKeyboardListeners = async () => {
      if (!window.Capacitor) return
      try {
        const keyboard = await getCapacitorKeyboard()
        if (!keyboard?.addListener) return
        const onShow = (info) => {
          const nativeHeight = Number(info?.keyboardHeight || 0)
          keyboardSettleUntilRef.current = Date.now() + 420
          if (isAndroidPlatform) {
            const visibleViewportHeight = Math.round(
              window.visualViewport?.height ||
              window.innerHeight ||
              viewportHeight ||
              0,
            )
            const baseline = Math.max(maxViewportHeightRef.current || 0, visibleViewportHeight)
            const resizedDelta = Math.max(0, baseline - visibleViewportHeight)
            // Use only the remaining keyboard height not already applied by viewport resize.
            const remainingOffset = Math.max(0, nativeHeight - resizedDelta)
            setKeyboardOffset(remainingOffset <= 28 ? 0 : remainingOffset)
          }
          if (nativeHeight > 0 && isIosPlatform && typeof window.visualViewport === 'undefined') {
            setKeyboardOffset(nativeHeight)
          }
          setIsKeyboardOpen(true)
        }
        const onHide = () => {
          keyboardSettleUntilRef.current = Date.now() + 220
          setKeyboardOffset(0)
          setIsKeyboardOpen(false)
          queueSyncKeyboardFromViewport()
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
    queueSyncKeyboardFromViewport()
    return () => {
      isCancelled = true
      window.removeEventListener('focusin', onFocusIn)
      window.removeEventListener('focusout', onFocusOut)
      viewport?.removeEventListener('resize', queueSyncKeyboardFromViewport)
      viewport?.removeEventListener('scroll', queueSyncKeyboardFromViewport)
      window.removeEventListener('resize', queueSyncKeyboardFromViewport)
      window.removeEventListener('orientationchange', queueSyncKeyboardFromViewport)
      if (syncRafId) cancelAnimationFrame(syncRafId)
      handles.forEach((handle) => handle?.remove?.())
      syncKeyboardLayoutRef.current = () => {}
    }
  }, [isIosPlatform, isAndroidPlatform])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    if (!isMobileView) return undefined
    if (!isNativeCapacitorRuntime()) return undefined

    let appStateHandle = null
    let cancelled = false
    const wakeTimers = []

    const isMessageInputFocused = () => {
      const active = document.activeElement
      return active instanceof HTMLElement && Boolean(active.closest('.message-input'))
    }

    const refreshViewportState = () => {
      const viewport = window.visualViewport
      const fallbackHeight = getViewportFallbackHeight()
      const rawMeasuredHeight = Math.round(viewport?.height || window.innerHeight || 0)
      let measuredHeight = rawMeasuredHeight > 0 ? rawMeasuredHeight : fallbackHeight
      const measuredTop = Math.max(0, Math.round(viewport?.offsetTop || 0))
      const inputFocused = isMessageInputFocused()
      if (!inputFocused && fallbackHeight > 0 && measuredHeight < Math.round(fallbackHeight * 0.72)) {
        measuredHeight = fallbackHeight
      }
      const layoutHeight = Math.max(
        Math.round(window.innerHeight || 0),
        measuredHeight,
        fallbackHeight,
      )
      const measuredBottomGap = Math.max(0, layoutHeight - (measuredTop + measuredHeight))

      if (measuredHeight > 0) {
        maxViewportHeightRef.current = Math.max(maxViewportHeightRef.current || 0, measuredHeight, layoutHeight)
        setViewportHeight((prev) => (Math.abs((prev || 0) - measuredHeight) <= 2 ? prev : measuredHeight))
      }

      if (isAndroidPlatform) {
        setVisualViewportTop(0)
        setVisualViewportBottomGap(0)
      } else {
        setVisualViewportTop((prev) => (Math.abs((prev || 0) - measuredTop) <= 1 ? prev : measuredTop))
        setVisualViewportBottomGap((prev) => (Math.abs((prev || 0) - measuredBottomGap) <= 1 ? prev : measuredBottomGap))
      }

      if (!inputFocused) {
        keyboardSettleUntilRef.current = 0
        setKeyboardOffset(0)
        setIsKeyboardOpen(false)
      }

      syncKeyboardLayoutRef.current?.()
    }

    const runWakeRefresh = () => {
      refreshViewportState()
      const delays = [80, 220, 480, 900]
      delays.forEach((delay) => {
        const timerId = window.setTimeout(() => {
          if (cancelled) return
          refreshViewportState()
        }, delay)
        wakeTimers.push(timerId)
      })
    }

    const onFocus = () => runWakeRefresh()
    const onPageShow = () => runWakeRefresh()
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      runWakeRefresh()
    }

    window.addEventListener('focus', onFocus)
    window.addEventListener('pageshow', onPageShow)
    document.addEventListener('visibilitychange', onVisibility)

    const setupAppStateListener = async () => {
      try {
        const mod = await import('@capacitor/app')
        if (cancelled) return
        appStateHandle = await mod.App.addListener('appStateChange', (state) => {
          if (!state?.isActive) return
          runWakeRefresh()
        })
      } catch {
        // Ignore App plugin availability errors.
      }
    }

    setupAppStateListener()
    runWakeRefresh()

    return () => {
      cancelled = true
      wakeTimers.forEach((id) => window.clearTimeout(id))
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pageshow', onPageShow)
      document.removeEventListener('visibilitychange', onVisibility)
      appStateHandle?.remove?.()
    }
  }, [isAndroidPlatform, isMobileView])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const nativeRuntime = isNativeCapacitorRuntime()
    const shouldDeferVideoThumbs = messages.length > 140
    if (shouldDeferVideoThumbs) return undefined
    const videoUrls = [...new Set(
      messages
        .filter((msg) => msg?.type === 'video' && msg?.mediaUrl)
        .map((msg) => String(msg.mediaUrl))
    )]
    if (videoUrls.length === 0) return undefined
    const batchSize = nativeRuntime ? 1 : 3
    const pendingUrls = videoUrls.filter((url) => videoThumbMap[url] === undefined).slice(-batchSize)
    if (pendingUrls.length === 0) return undefined

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
          const maxEdge = 360
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
        if (videoThumbMap[url] !== undefined) continue
        const thumb = await generateThumb(url)
        if (cancelled || !thumb) continue
        setVideoThumbMap((prev) => {
          if (prev[url]) return prev
          return { ...prev, [url]: thumb }
        })
        if (nativeRuntime) {
          await new Promise((resolve) => setTimeout(resolve, 120))
        }
      }
    }

    let idleCallbackId = null
    let timeoutId = null
    if (window.requestIdleCallback) {
      idleCallbackId = window.requestIdleCallback(() => { loadThumbs() }, { timeout: 900 })
    } else {
      timeoutId = window.setTimeout(() => { loadThumbs() }, 140)
    }
    return () => {
      cancelled = true
      if (idleCallbackId !== null) window.cancelIdleCallback?.(idleCallbackId)
      if (timeoutId !== null) window.clearTimeout(timeoutId)
    }
  }, [messages, videoThumbMap])

  useEffect(() => {
    if (!flow.username || !flow.token) {
      navigate('/auth')
      return
    }
    if ((flow.role || 'game') !== 'chat') {
      navigate('/games')
      return
    }
    if (!flow.verified) {
      navigate('/profile')
    }
  }, [flow.username, flow.token, flow.role, flow.verified, navigate])

  useEffect(() => {
    if (!flow.token) return
    getMe(flow.token).catch((error) => {
      if (error?.response?.status === 401) {
        notify.error('Session expired, login again.')
        resetFlowState(setFlow)
        navigate('/auth')
      }
    })
  }, [flow.token, setFlow, navigate])

  useEffect(() => {
    if (!flow.username) return
    const cachedUsers = readUsersCache()
    if (!cachedUsers.length) return
    setUsers((prev) => (prev.length ? prev : cachedUsers))
  }, [flow.username])

  useEffect(() => {
    if (!flow.token || !flow.username) return
    let cancelled = false

    const loadUsersFromDb = async () => {
      try {
        const dbUsers = await getAllUsers(flow.token)
        const serverSummaries = await getConversationSummaries(flow.token, {
          timeoutMs: USERS_SUMMARY_TIMEOUT_MS,
        }).catch(() => [])
        if (cancelled) return
        const me = (flow.username || '').toLowerCase()
        const cachedByKey = readUsersCache().reduce((acc, row) => {
          acc[toUserKey(row.username)] = row
          return acc
        }, {})
        const summaryByKey = (serverSummaries || []).reduce((acc, row) => {
          const userKey = toUserKey(row?.peerUsername)
          if (!userKey) return acc
          acc[userKey] = summarizeServerConversationSummary(row)
          return acc
        }, {})
        const list = (dbUsers || [])
          .filter((user) => {
            const username = (user?.username || '').trim()
            return username && username.toLowerCase() !== me
          })
          .map((user) => {
            const username = (user.username || '').trim()
            const userKey = toUserKey(username)
            const cacheRow = cachedByKey[toUserKey(username)] || {}
            const summaryRow = summaryByKey[userKey] || {}
            const cacheLastCreatedAt = Number(cacheRow.lastCreatedAt || 0) || 0
            const summaryLastCreatedAt = Number(summaryRow.lastCreatedAt || 0) || 0
            const useSummary = summaryLastCreatedAt >= cacheLastCreatedAt
            const activePreview = useSummary ? summaryRow : cacheRow
            const hasConversation = Boolean(activePreview.hasConversation)
              || Boolean(String(activePreview.lastMessage || '').trim())
              || Boolean(String(activePreview.timestamp || '').trim())
            return {
              id: user.id,
              username,
              name: (user.name || '').trim(),
              status: 'offline',
              lastMessage: String(activePreview.lastMessage || ''),
              timestamp: String(activePreview.timestamp || ''),
              hasConversation,
              lastCreatedAt: Math.max(cacheLastCreatedAt, summaryLastCreatedAt),
            }
          })

        setUsers((prev) => {
          const prevByKey = (prev || []).reduce((acc, row) => {
            acc[toUserKey(row.username)] = row
            return acc
          }, {})
          return list.map((user) => {
            const prevRow = prevByKey[toUserKey(user.username)]
            if (!prevRow) return user
            const prevLastCreatedAt = Number(prevRow.lastCreatedAt || 0) || 0
            const nextLastCreatedAt = Number(user.lastCreatedAt || 0) || 0
            const keepPrevPreview = prevLastCreatedAt >= nextLastCreatedAt
              && (Boolean(prevRow.hasConversation)
              || Boolean(String(prevRow.lastMessage || '').trim())
              || Boolean(String(prevRow.timestamp || '').trim()))
            if (!keepPrevPreview) return user
            return {
              ...user,
              lastMessage: prevRow.lastMessage || user.lastMessage || '',
              timestamp: prevRow.timestamp || user.timestamp || '',
              hasConversation: Boolean(prevRow.hasConversation)
                || Boolean(String(prevRow.lastMessage || '').trim())
                || Boolean(String(prevRow.timestamp || '').trim())
                || Boolean(user.hasConversation),
              lastCreatedAt: Math.max(prevLastCreatedAt, nextLastCreatedAt),
            }
          })
        })
      } catch (error) {
        console.error('Failed loading users from database', error)
        if (!readUsersCache().length) {
          notify.error('Failed to load users from database.')
        }
      }
    }

    loadUsersFromDb()
    return () => {
      cancelled = true
    }
  }, [flow.token, flow.username, isMobileView, usersReloadTick])

  useEffect(() => {
    if (!flow.username || !users.length) return
    writeUsersCache(users)
  }, [users, flow.username])

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
      shouldAutoScrollToBottomRef.current = true
      setMessages([])
      setHasOlderMessages(false)
      hasOlderMessagesRef.current = false
      setIsLoadingOlderMessages(false)
      loadingOlderMessagesRef.current = false
      nextConversationPageRef.current = 1
      return
    }
    const targetUsername = selectedUser.username
    shouldAutoScrollToBottomRef.current = true
    const targetKey = toUserKey(targetUsername)
    const clearCutoff = getConversationClearCutoff(targetUsername)
    const memoryCachedRows = conversationCacheRef.current[targetKey]
    const diskCachedRows = readConversationCache(targetUsername, clearCutoff)
    const cachedRows = memoryCachedRows?.length ? memoryCachedRows : diskCachedRows
    const hasImmediateData = Array.isArray(cachedRows) && cachedRows.length > 0
    setIsLoadingOlderMessages(false)
    loadingOlderMessagesRef.current = false
    setHasOlderMessages(Boolean(cachedRows?.length >= CONVERSATION_PAGE_SIZE))
    hasOlderMessagesRef.current = Boolean(cachedRows?.length >= CONVERSATION_PAGE_SIZE)
    nextConversationPageRef.current = 1
    if (Array.isArray(cachedRows) && cachedRows.length) {
      setMessages((prev) => {
          const existingTempIds = new Set(
            (cachedRows || [])
              .map((row) => String(row?.tempId || '').trim())
              .filter((value) => value)
          )
          const pendingUploads = (prev || []).filter((msg) => {
            const peerKey = toUserKey(msg?.peerUsername)
            const tempIdValue = String(msg?.tempId || '').trim()
            return msg?.sender === 'user'
              && (msg?.deliveryStatus === 'uploading' || msg?.deliveryStatus === 'queued' || msg?.deliveryStatus === 'failed')
              && tempIdValue
              && peerKey
              && peerKey === targetKey
              && !existingTempIds.has(tempIdValue)
          })
          if (!pendingUploads.length) return cachedRows
          return [...cachedRows, ...pendingUploads]
        })
    }
    let cancelled = false
    let attempt = 0
    const fetchConversation = () => {
      getConversation(flow.token, targetUsername, { page: 0, size: CONVERSATION_PAGE_SIZE })
      .then((result) => {
        if (cancelled) return
        if (toUserKey(selectedUserRef.current?.username) !== targetKey) return
        const rows = Array.isArray(result?.messages) ? result.messages : []
        const normalized = normalizeConversationRows(rows, clearCutoff, targetUsername)
        conversationCacheRef.current[targetKey] = normalized
        writeConversationCache(targetUsername, normalized)
        setMessages((prev) => {
          const existingTempIds = new Set(
            (normalized || [])
              .map((row) => String(row?.tempId || '').trim())
              .filter((value) => value)
          )
          const pendingUploads = (prev || []).filter((msg) => {
            const peerKey = toUserKey(msg?.peerUsername)
            const tempIdValue = String(msg?.tempId || '').trim()
            return msg?.sender === 'user'
              && (msg?.deliveryStatus === 'uploading' || msg?.deliveryStatus === 'queued' || msg?.deliveryStatus === 'failed')
              && tempIdValue
              && peerKey
              && peerKey === targetKey
              && !existingTempIds.has(tempIdValue)
          })
          if (!pendingUploads.length) return normalized
          return [...normalized, ...pendingUploads]
        })
        setHasOlderMessages(Boolean(result?.hasMore))
        hasOlderMessagesRef.current = Boolean(result?.hasMore)
        nextConversationPageRef.current = 1
        const latestIncoming = normalized
          .filter((msg) => msg.sender === 'other')
          .reduce((max, msg) => Math.max(max, Number(msg.createdAt || msg.clientCreatedAt || 0)), 0)
        if (latestIncoming) {
          publishReadReceipt(targetUsername, latestIncoming)
        }
        setReplyingTo(null)
      })
      .catch((error) => {
        if (cancelled) return
        if (error?.response?.status === 401) {
          notify.error('Session expired. Please login again.')
          resetFlowState(setFlow)
          navigate('/auth')
          return
        }
        const status = Number(error?.response?.status || 0)
        const code = String(error?.code || '')
        const transientFailure =
          !status ||
          status === 429 ||
          status >= 500 ||
          code === 'ERR_NETWORK' ||
          code === 'ECONNABORTED' ||
          code === 'ETIMEDOUT'

        if (transientFailure && attempt < CONVERSATION_FETCH_RETRY_LIMIT) {
          attempt += 1
          const delay = Math.min(2500, 450 * (2 ** (attempt - 1)))
          setTimeout(() => {
            if (!cancelled) fetchConversation()
          }, delay)
          return
        }

        console.error('Failed loading conversation', error)
        if (!hasImmediateData) {
          notify.error('Failed to load conversation history.')
        }
      })
    }
    fetchConversation()
    return () => {
      cancelled = true
    }
  }, [selectedUser, flow.token, conversationClears, conversationReloadTick])

  const loadOlderMessages = async () => {
    if (!selectedUser || !flow.token) return
    if (!hasOlderMessagesRef.current || loadingOlderMessagesRef.current) return

    const targetUsername = selectedUser.username
    const targetKey = toUserKey(targetUsername)
    const pageToLoad = Number(nextConversationPageRef.current || 0)
    if (pageToLoad < 1) return

    loadingOlderMessagesRef.current = true
    setIsLoadingOlderMessages(true)
    shouldAutoScrollToBottomRef.current = false

    const listEl = messagesAreaRef.current
    const previousScrollTop = Number(listEl?.scrollTop || 0)
    const previousScrollHeight = Number(listEl?.scrollHeight || 0)

    try {
      const result = await getConversation(flow.token, targetUsername, { page: pageToLoad, size: CONVERSATION_PAGE_SIZE })
      if (toUserKey(selectedUserRef.current?.username) !== targetKey) return

      const clearCutoff = getConversationClearCutoff(targetUsername)
      const olderRows = normalizeConversationRows(result?.messages || [], clearCutoff, targetUsername)
      setMessages((prev) => prependOlderMessages(olderRows, prev))
      setHasOlderMessages(Boolean(result?.hasMore))
      hasOlderMessagesRef.current = Boolean(result?.hasMore)
      nextConversationPageRef.current = pageToLoad + 1

        if (listEl) {
          window.requestAnimationFrame(() => {
            const updatedHeight = Number(listEl.scrollHeight || 0)
            const delta = Math.max(0, updatedHeight - previousScrollHeight)
            listEl.scrollTop = previousScrollTop + delta
            updateScrollToLatestVisibility()
          })
        }
    } catch {
      notify.warn('Failed to load older messages. Scroll up to retry.')
    } finally {
      loadingOlderMessagesRef.current = false
      setIsLoadingOlderMessages(false)
    }
  }

  useEffect(() => {
    if (!flow.username || !selectedUser?.username || !messages?.length) return
    const stableRows = messages.filter((row) => (
      row?.deliveryStatus !== 'uploading' && row?.deliveryStatus !== 'queued' && row?.deliveryStatus !== 'failed'
    ))
    if (!stableRows.length) return
    conversationCacheRef.current[toUserKey(selectedUser.username)] = stableRows
    writeConversationCache(selectedUser.username, stableRows)
  }, [messages, selectedUser?.username, flow.username])

  useEffect(() => {
    if (!flow.token || !flow.username) return
    const triggerRefresh = () => {
      const now = Date.now()
      if (now - Number(lastAutoRefreshAtRef.current || 0) < AUTO_REFRESH_DEBOUNCE_MS) return
      lastAutoRefreshAtRef.current = now
      setUsersReloadTick(now)
      setConversationReloadTick(now)
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
    if (typeof window === 'undefined') return undefined

    let offlineRedirectTimer = null
    const clearOfflineTimer = () => {
      if (!offlineRedirectTimer) return
      window.clearTimeout(offlineRedirectTimer)
      offlineRedirectTimer = null
    }
    const startOfflineTimer = () => {
      if (offlineRedirectTimer) return
      offlineRedirectTimer = window.setTimeout(() => {
        notify.info('You were offline for 1 minute. Redirecting to dashboard.')
        navigate('/games', { replace: true })
      }, OFFLINE_DASHBOARD_REDIRECT_MS)
    }

    const onOffline = () => startOfflineTimer()
    const onOnline = () => clearOfflineTimer()

    if (navigator.onLine === false) {
      startOfflineTimer()
    }

    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    return () => {
      clearOfflineTimer()
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
    }
  }, [navigate])

  useEffect(() => {
    if (loadingOlderMessagesRef.current) return
    if (!shouldAutoScrollToBottomRef.current) return
    scrollMessagesToBottom('auto')
  }, [messages])

  useEffect(() => {
    const rafId = window.requestAnimationFrame(() => {
      updateScrollToLatestVisibility()
    })
    return () => window.cancelAnimationFrame(rafId)
  }, [messages, selectedUser?.username])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const syncVisibility = () => updateScrollToLatestVisibility()
    window.addEventListener('scroll', syncVisibility, { passive: true })
    window.addEventListener('resize', syncVisibility)
    return () => {
      window.removeEventListener('scroll', syncVisibility)
      window.removeEventListener('resize', syncVisibility)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    if (!isMobileView) return undefined
    if (!isNativeCapacitorRuntime()) return undefined
    const viewport = window.visualViewport
    if (!viewport) return undefined

    const keepBottomVisible = () => {
      scrollMessagesToBottom('auto')
      setTimeout(() => scrollMessagesToBottom('auto'), 120)
      setTimeout(() => scrollMessagesToBottom('auto'), 320)
      setTimeout(() => scrollMessagesToBottom('auto'), 650)
      startKeyboardBottomLock(1500)
    }

    viewport.addEventListener('resize', keepBottomVisible)
    return () => {
      viewport.removeEventListener('resize', keepBottomVisible)
    }
  }, [isMobileView])

  
  useEffect(() => {
    if (!isKeyboardOpen) return
    if (!isMobileView) return
    if (!isNativeCapacitorRuntime()) return
    const active = document.activeElement
    const isTypingTarget = active instanceof HTMLElement && Boolean(active.closest('.message-input'))
    if (!isTypingTarget) return
    scrollMessagesToBottom('auto')
    setTimeout(() => scrollMessagesToBottom('auto'), 120)
    setTimeout(() => scrollMessagesToBottom('auto'), 320)
    setTimeout(() => scrollMessagesToBottom('auto'), 650)
    startKeyboardBottomLock(1500)
  }, [isKeyboardOpen, viewportHeight, selectedUser?.username, isMobileView])

  useEffect(() => () => {
    stopKeyboardBottomLock()
  }, [])

  useEffect(() => {
    if (!selectedUser?.username || !socket?.connected) return
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
    const latestIncoming = getLatestIncomingCreatedAt(selectedUser.username)
    if (!latestIncoming) return
    publishReadReceipt(selectedUser.username, latestIncoming)
  }, [messages, selectedUser?.username, socket?.connected])

  useEffect(() => {
    if (checkOpenTimerRef.current) {
      clearTimeout(checkOpenTimerRef.current)
      checkOpenTimerRef.current = null
    }
    if (!selectedUser?.username || !(flow.token || '').trim() || !(flow.username || '').trim()) return undefined
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return undefined

    const openerUsername = (flow.username || '').trim()
    const conversationWithUsername = (selectedUser.username || '').trim()
    const visitKey = `${toUserKey(openerUsername)}::${toUserKey(conversationWithUsername)}`
    console.log('VISIT KEY CHECK:', countedCheckVisitKeyRef.current, '===', visitKey)
    if (countedCheckVisitKeyRef.current === visitKey) return undefined

    checkOpenTimerRef.current = window.setTimeout(async () => {
      try {
        console.log('FIRING CHECK-OPEN PING for:', conversationWithUsername)
        const result = await reportChatOpen(flow.token, openerUsername, conversationWithUsername)
        console.log('CHECK-OPEN RESULT:', result)
        if (result?.counted) {
          countedCheckVisitKeyRef.current = visitKey
        }
      } catch (err) {
        console.error('CHECK-OPEN ERROR:', err)
      }
    }, 1000)

    return () => {
      if (checkOpenTimerRef.current) {
        clearTimeout(checkOpenTimerRef.current)
        checkOpenTimerRef.current = null
      }
    }
  }, [selectedUser?.username, flow.token, flow.username, location.key])

  useEffect(() => {
    countedCheckVisitKeyRef.current = ''
  }, [selectedUser?.username])

  useEffect(() => {
    const authToken = (flow.token || '').trim()
    const authUsername = (flow.username || '').trim()
    if (!authToken || !authUsername) return

    let onlineHeartbeatTimer = null
    const publishOnlinePresence = () => {
      if (!client.connected) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return
      client.publish({
        destination: '/app/user.online',
        body: JSON.stringify({ username: authUsername }),
      })
    }
    const onAppVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      publishOnlinePresence()
    }

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
        publishOnlinePresence()
        if (onlineHeartbeatTimer) {
          clearInterval(onlineHeartbeatTimer)
        }
        onlineHeartbeatTimer = setInterval(() => {
          publishOnlinePresence()
        }, ONLINE_HEARTBEAT_MS)
        if (selectedUserRef.current?.username) {
          setConversationReloadTick(Date.now())
        }

        const consumeStatus = (frame) => {
          try {
            const payload = JSON.parse(frame.body)
            const username = payload?.username
            const status = String(payload?.status || '').trim().toLowerCase()
            const lastSeenAt = Number(payload?.lastSeenAt || 0) || null
            if (!username || !status) return
            if (status !== 'online' && status !== 'offline') return
            const userKey = toUserKey(username)
            if (!userKey) return
            const previousStatus = String(statusMapRef.current[userKey]?.status || '').trim().toLowerCase()
            setStatusMap((prev) => ({ ...prev, [userKey]: { status, lastSeenAt } }))
            if (status === 'online' && previousStatus !== 'online') {
              updatePresenceLastSeen(username, Date.now())
            } else if (lastSeenAt) {
              setTypingMap((prev) => ({ ...prev, [userKey]: false }))
              updatePresenceLastSeen(username, lastSeenAt)
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
            const fromUserKey = toUserKey(fromUsername)
            const incomingClientMessageId = String(data?.clientMessageId || '').trim() || null
            const incomingCreatedAt = Number(data?.createdAt || Date.now())
            const clearCutoff = getConversationClearCutoff(fromUsername)
            if (clearCutoff && incomingCreatedAt <= clearCutoff) {
              return
            }

            setTypingMap((prev) => ({ ...prev, [fromUserKey]: false }))

            const incoming = {
              sender: 'other',
              text,
              type: data?.type || null,
              fileName: data?.fileName || null,
              mediaUrl: normalizeMediaUrl(data?.mediaUrl || null),
              mediaType: data?.mediaType || data?.type || null,
              mimeType: data?.mimeType || null,
              reaction: decodeReaction(data?.reaction),
              replyingTo: data?.replyingTo || (data?.replyText
                ? {
                    text: data.replyText,
                    senderName: data?.replySenderName || fromUsername,
                    messageId: data?.replyMessageId || null,
                    type: data?.replyType || null,
                    mediaUrl: normalizeMediaUrl(data?.replyMediaUrl || null),
                    mimeType: data?.replyMimeType || null,
                    fileName: data?.replyFileName || null,
                  }
                : null),
              createdAt: incomingCreatedAt || null,
              clientCreatedAt: incomingCreatedAt || Date.now(),
              timestamp: getTimeLabel(),
              senderName: formatUsername(fromUsername),
              peerUsername: fromUserKey,
              tempId: incomingClientMessageId,
              messageId: data?.id,
              edited: Boolean(data?.edited || data?.isEdited),
              editedAt: Number(data?.editedAt || 0) || null,
            }
            incoming.timestamp = formatTimestamp(incoming.createdAt)
            const incomingPreview = getNotificationPreview(incoming.type, incoming.text, incoming.fileName, authUsername)
            setStatusMap((prev) => ({ ...prev, [toUserKey(fromUsername)]: { status: 'online', lastSeenAt: null } }))
            updatePresenceLastSeen(fromUsername, incomingCreatedAt || Date.now())
            if (!shouldSuppressChatNotification(fromUsername)) {
              await pushNotify(`@${formatUsername(fromUsername)}`, incomingPreview)
            }
            setNotifyCutoff(authUsername, fromUsername, incomingCreatedAt || Date.now())

            setUsers((prev) =>
              prev.map((user) =>
                toUserKey(user.username) === fromUserKey
                  ? (
                      isSecretTapMessageType(incoming.type)
                        ? user
                        : { ...user, lastMessage: text, timestamp: getTimeLabel(), hasConversation: true, lastCreatedAt: incomingCreatedAt || Date.now() }
                    )
                  : user
              )
            )

            if (toUserKey(selectedUserRef.current?.username) === fromUserKey) {
              // Update existing message or add new one
              setMessages((prev) => {
                const existingIndex = prev.findIndex((msg) => {
                  if (incomingClientMessageId && msg?.tempId && String(msg.tempId) === incomingClientMessageId) {
                    return true
                  }
                  return isSameIncomingMessage(msg, incoming)
                })
                if (existingIndex >= 0) {
                  const updated = [...prev]
                  updated[existingIndex] = {
                    ...updated[existingIndex],
                    ...incoming,
                    createdAt: incoming.createdAt,
                    clientCreatedAt: incoming.clientCreatedAt,
                  }
                  return trimMessageHistory(updated)
                }
                return trimMessageHistory([...prev, incoming])
              })
              setMilestoneTriggerTick((prev) => prev + 1)
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
            const fromUserKey = toUserKey(fromUsername)
            setTypingMap((prev) => ({ ...prev, [fromUserKey]: typing }))
            if (typing) {
              setStatusMap((prev) => ({ ...prev, [toUserKey(fromUsername)]: { status: 'online', lastSeenAt: null } }))
              updatePresenceLastSeen(fromUsername, Date.now())
              if (incomingTypingTimeoutsRef.current[fromUserKey]) {
                clearTimeout(incomingTypingTimeoutsRef.current[fromUserKey])
              }
              incomingTypingTimeoutsRef.current[fromUserKey] = setTimeout(() => {
                setTypingMap((prev) => ({ ...prev, [fromUserKey]: false }))
                delete incomingTypingTimeoutsRef.current[fromUserKey]
              }, TYPING_STALE_MS)
            } else if (incomingTypingTimeoutsRef.current[fromUserKey]) {
              clearTimeout(incomingTypingTimeoutsRef.current[fromUserKey])
              delete incomingTypingTimeoutsRef.current[fromUserKey]
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
            const ackMessageId = Number(ack?.messageId || ack?.id || 0)

            if (sendAckTimeoutsRef.current[tempId]) {
              clearTimeout(sendAckTimeoutsRef.current[tempId])
              delete sendAckTimeoutsRef.current[tempId]
            }

            if (ack?.success && ackMessageId > 0) {
              setLastSentMessageId(ackMessageId)
              setMilestoneTriggerTick((prev) => prev + 1)
            }

            setMessages((prev) =>
              prev.map((msg) => (
                msg.tempId === tempId
                  ? {
                      ...msg,
                      deliveryStatus: ack?.success ? 'sent' : 'failed',
                      tempId: ack?.success ? null : msg.tempId,
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
              notify.error(`Edit failed: ${ack.reason}`)
            } else {
              notify.error('Edit failed.')
            }
          } catch {
            // Ignore invalid edit acks.
          }
        })

        client.subscribe('/user/queue/message-deletes', (frame) => {
          try {
            const event = JSON.parse(frame.body)
            const messageId = Number(event?.messageId || 0)
            if (!messageId) return
            const deleteKey = `id:${messageId}`
            const fromKey = toUserKey(event?.fromUsername)
            const toKey = toUserKey(event?.toUsername)
            const meKey = toUserKey(authUsername)
            const activePeer = toUserKey(selectedUserRef.current?.username)
            const affectsActiveConversation = Boolean(
              activePeer &&
              ((fromKey === meKey && toKey === activePeer) || (toKey === meKey && fromKey === activePeer))
            )

            setMessages((prev) => {
              const next = prev.filter((msg) => Number(msg?.messageId || 0) !== messageId)
              if (affectsActiveConversation && next.length !== prev.length) {
                syncConversationSummaryForUser(selectedUserRef.current?.username, next)
              }
              return next
            })
            setEditingMessage((prev) => (prev?.key === deleteKey ? null : prev))
            setReplyingTo((prev) => (Number(prev?.messageId || 0) === messageId ? null : prev))
            setReactionTray((prev) => (prev?.messageKey === deleteKey ? null : prev))
            setActiveMessageActionsKey((prev) => (prev === deleteKey ? null : prev))

            if (!affectsActiveConversation && (fromKey === meKey || toKey === meKey)) {
              setUsersReloadTick(Date.now())
            }
          } catch (error) {
            console.error('Failed parsing message delete payload', error)
          }
        })

        client.subscribe('/user/queue/delete-ack', (frame) => {
          try {
            const ack = JSON.parse(frame.body)
            if (ack?.success) return
            notify.error(ack?.reason ? `Delete failed: ${ack.reason}` : 'Delete failed.')
            setUsersReloadTick(Date.now())
            setConversationReloadTick(Date.now())
          } catch {
            // Ignore invalid delete acks.
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

        client.subscribe('/user/queue/check-count-notices', (frame) => {
          try {
            console.log('CHECK NOTICE RAW:', frame.body)
            const event = JSON.parse(frame.body)
            const checkerUsername = String(event?.checkerUsername || '').trim()
            const checkCount = Number(event?.checkCount || 0)
            if (!checkerUsername || checkCount <= 0) return
            setCheckPopup({ username: checkerUsername, count: checkCount })
          } catch (error) {
            console.error('Failed parsing check-count notice payload', error)
          }
        })

        // Retry queued/failed messages after reconnection
        setTimeout(() => {
          setMessages((prev) => {
            const queuedMessages = prev.filter((msg) => msg.deliveryStatus === 'queued' || msg.deliveryStatus === 'failed')
            const activeSocket = socketRef.current
            
            if (queuedMessages.length > 0 && activeSocket?.connected) {
              queuedMessages.forEach((msg) => {
                if (msg.type === 'text' || isSecretTapMessageType(msg.type)) {
                  activeSocket.publish({
                    destination: '/app/chat.send',
                    body: JSON.stringify({
                      toUsername: msg.peerUsername,
                      message: msg.text,
                      fromUsername: flow.username,
                      tempId: msg.tempId,
                      type: msg.type,
                      replyingTo: msg.replyingTo ? buildReplyPayload(msg.replyingTo) : null,
                      replyText: msg.replyingTo ? toReplyText(msg.replyingTo) : null,
                      replySenderName: msg.replyingTo?.senderName || null,
                      replyMessageId: msg.replyingTo?.messageId || null,
                      replyType: msg.replyingTo?.type || null,
                      replyMediaUrl: msg.replyingTo ? normalizeMediaUrl(msg.replyingTo?.mediaUrl || null) : null,
                      replyMimeType: msg.replyingTo?.mimeType || null,
                      replyFileName: msg.replyingTo?.fileName || null,
                    }),
                  })
                  // Reset timeout for retry
                  if (sendAckTimeoutsRef.current[msg.tempId]) {
                    clearTimeout(sendAckTimeoutsRef.current[msg.tempId])
                  }
                  sendAckTimeoutsRef.current[msg.tempId] = setTimeout(() => {
                    setMessages((current) => current.map((m) => (m.tempId === msg.tempId ? { ...m, deliveryStatus: 'queued' } : m)))
                    delete sendAckTimeoutsRef.current[msg.tempId]
                  }, SEND_ACK_TIMEOUT_MS)
                }
              })
            }
            return prev
          })
        }, 300)
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
    socketRef.current = client
    window.addEventListener('focus', onAppVisible)
    window.addEventListener('pageshow', onAppVisible)
    document.addEventListener('visibilitychange', onAppVisible)

    return () => {
      window.removeEventListener('focus', onAppVisible)
      window.removeEventListener('pageshow', onAppVisible)
      document.removeEventListener('visibilitychange', onAppVisible)
      if (onlineHeartbeatTimer) {
        clearInterval(onlineHeartbeatTimer)
        onlineHeartbeatTimer = null
      }
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
      if (socketRef.current === client) {
        socketRef.current = null
      }
      client.deactivate()
    }
  }, [flow.token, flow.username])

  useEffect(() => {
    if (!flow.token || !flow.username || !users.length) return

    let cancelled = false
    let syncing = false

    const notifyMissedWhileOffline = async () => {
      if (selectedUserRef.current?.username) return
      if (syncing) return
      syncing = true
      try {
        for (const user of users) {
          if (cancelled) return
          try {
            const cutoff = getNotifyCutoff(flow.username, user.username)
            const missed = await getMissedIncomingSince(flow.token, user.username, cutoff)
            if (cancelled) return
            if (!missed?.count) continue

            setNotifyCutoff(flow.username, user.username, missed.latestIncomingAt || Date.now())
            setUnreadMap((prev) => ({ ...prev, [toUserKey(user.username)]: true }))
            if (!shouldSuppressChatNotification(user.username)) {
              await pushNotify(`@${formatUsername(user.username)}`, `${missed.count} new message${missed.count > 1 ? 's' : ''}`)
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

    window.addEventListener('focus', notifyMissedWhileOffline)
    window.addEventListener('online', notifyMissedWhileOffline)
    document.addEventListener('visibilitychange', onResume)
    return () => {
      cancelled = true
      window.removeEventListener('focus', notifyMissedWhileOffline)
      window.removeEventListener('online', notifyMissedWhileOffline)
      document.removeEventListener('visibilitychange', onResume)
    }
  }, [flow.token, flow.username, users, selectedUser?.username])

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
    if (showAttachMenu && attachMenuRef.current) {
      const rect = attachMenuRef.current.getBoundingClientRect()
      const inputArea = document.querySelector('.input-area')
      const footerTop = inputArea ? inputArea.getBoundingClientRect().top : rect.top
      
      setAttachDropdownPos({
        top: footerTop - 220, // Position above footer (220px for dropdown + gap)
        right: window.innerWidth - rect.right
      })
    }
  }, [showAttachMenu])

  const hasComposerText = Boolean(String(inputValue || '').trim())

  useEffect(() => {
    if (hasComposerText && showAttachMenu) {
      setShowAttachMenu(false)
    }
  }, [hasComposerText, showAttachMenu])

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
    notify.clearWaitingQueue()
    notify.error(message, {
      toastId: REALTIME_TOAST_ID,
      autoClose: 1500,
    })
  }

  const shouldSuppressChatNotification = (fromUsername) => {
    void fromUsername
    const activePath = getNormalizedRoutePath(location)
    if (activePath.startsWith('/chat') && selectedUserRef.current?.username) {
      // Chat screen handles live updates directly; suppress system notifications here.
      return true
    }
    return false
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

  const stopKeyboardBottomLock = () => {
    const rafId = Number(keyboardBottomLockRef.current.rafId || 0)
    if (rafId) {
      cancelAnimationFrame(rafId)
    }
    keyboardBottomLockRef.current = { rafId: 0, until: 0 }
  }

  const startKeyboardBottomLock = (durationMs = 1400) => {
    if (typeof window === 'undefined') return
    if (!isNativeCapacitorRuntime()) return
    const until = Date.now() + Math.max(0, durationMs)
    keyboardBottomLockRef.current.until = until
    if (keyboardBottomLockRef.current.rafId) return

    const tick = () => {
      const active = document.activeElement
      const isTypingTarget = active instanceof HTMLElement && Boolean(active.closest('.message-input'))
      if (!isTypingTarget) {
        stopKeyboardBottomLock()
        return
      }
      scrollMessagesToBottom('auto')
      if (Date.now() >= Number(keyboardBottomLockRef.current.until || 0)) {
        stopKeyboardBottomLock()
        return
      }
      keyboardBottomLockRef.current.rafId = requestAnimationFrame(tick)
    }

    keyboardBottomLockRef.current.rafId = requestAnimationFrame(tick)
  }

  const scrollMessagesToBottom = (behavior = 'auto') => {
    shouldAutoScrollToBottomRef.current = true
    setHighlightedMessageKey('')
    setShowScrollToLatest(false)
    const listEl = messagesAreaRef.current
    if (listEl) {
      try {
        listEl.scrollTo({ top: listEl.scrollHeight, behavior })
      } catch {
        listEl.scrollTop = listEl.scrollHeight
      }
      if (typeof window !== 'undefined') {
        window.requestAnimationFrame(() => updateScrollToLatestVisibility())
      }
      return
    }
    // Fallback only if list ref is temporarily unavailable.
    messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' })
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

  useEffect(() => () => {
    if (highlightClearTimerRef.current) {
      clearTimeout(highlightClearTimerRef.current)
      highlightClearTimerRef.current = null
    }
  }, [])

  const publishTyping = (typing, force = false, targetUsername = null) => {
    const toUsername = (targetUsername || selectedUser?.username || '').trim()
    const activeSocket = socketRef.current
    if (!toUsername) return
    if (!activeSocket?.connected) {
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
    activeSocket.publish({
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
    const activeSocket = socketRef.current
    if (!activeSocket?.connected || !peerUsername) return
    const nextReadAt = Number(readAtMs || 0)
    if (!nextReadAt) return
    const key = peerUsername.toLowerCase()
    const alreadySent = Number(lastPublishedReadAtRef.current[key] || 0)
    if (nextReadAt <= alreadySent) return
    lastPublishedReadAtRef.current[key] = nextReadAt
    activeSocket.publish({
      destination: '/app/chat.read',
      body: JSON.stringify({
        peerUsername,
        readerUsername: flow.username,
        readAt: nextReadAt,
      }),
    })
  }

  const filteredUsers = useMemo(() => {
    const normalizedSearch = searchQuery.toLowerCase().trim()
    const isSearching = normalizedSearch.length > 0
    return users
      .filter((user) => {
        const username = (user?.username || '').toLowerCase()
        const matchesSearch = username.includes(normalizedSearch)
        if (isSearching) return matchesSearch
        if (toUserKey(selectedUser?.username) === toUserKey(user?.username)) return true
        const hasConversation = Boolean(user?.hasConversation)
          || Boolean((user?.lastMessage || '').trim())
          || Boolean((user?.timestamp || '').trim())
        return hasConversation
      })
      .map((user) => {
        const presence = getResolvedPresence(user.username, 'offline')
        const isTyping = Boolean(typingMap[toUserKey(user.username)])
        const presenceTime = presence.status === 'online' ? 'online' : toShortLastSeen(presence.lastSeenAt)
        const hasUnread = Boolean(unreadMap[toUserKey(user.username)])
        return {
          ...user,
          _presence: presence,
          _isTyping: isTyping,
          _hasUnread: hasUnread,
          _presenceTime: presenceTime,
        }
      })
  }, [users, searchQuery, statusMap, typingMap, unreadMap, selectedUser?.username])
  const detailMediaItems = useMemo(
    () => messages.filter((msg) => msg.type && (msg.type === 'image' || msg.type === 'video') && msg.mediaUrl),
    [messages]
  )
  const detailFileItems = useMemo(
    () => messages.filter((msg) => msg.type === 'file' && msg.mediaUrl),
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
        fileItems: detailFileItems.map((msg) => ({
          type: msg.type,
          mediaUrl: msg.mediaUrl,
          fileName: msg.fileName || null,
          mimeType: msg.mimeType || null,
          createdAt: msg.createdAt || msg.clientCreatedAt || null,
        })),
      },
    })
  }
  const handleManualReload = () => {
    if (isManualRefreshing) return
    setIsManualRefreshing(true)
    setUsersReloadTick(Date.now())
    setConversationReloadTick(Date.now())
    window.setTimeout(() => setIsManualRefreshing(false), 900)
  }

  const handleDismissCheckPopup = async () => {
    const checkerUsername = (checkPopup.username || '').trim()
    setCheckPopup({ username: null, count: 0 })
    if (!checkerUsername || !(flow.token || '').trim() || !(flow.username || '').trim()) return
    try {
      await consumeCheckNotice(flow.token, flow.username, checkerUsername)
    } catch {
      // Ignore dismiss persistence failures.
    }
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
        notify.error('Message not found for edit.')
        setEditingMessage(null)
        return
      }
      if (!canEditMessage(currentTarget)) {
        notify.error('Message can only be edited within 15 minutes.')
        setEditingMessage(null)
        return
      }
      if (!socket?.connected) {
        notify.error('Realtime server disconnected. Edit not sent.')
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
      peerUsername: toUserKey(selectedUser.username),
      replyingTo,
      tempId,
      deliveryStatus: 'uploading',
    }

    setMessages((prev) => trimMessageHistory([...prev, outgoing]))
    setInputValue('')
    setReplyingTo(null)

    setUsers((prev) =>
      prev.map((user) =>
        toUserKey(user.username) === toUserKey(selectedUser.username)
          ? { ...user, lastMessage: text, timestamp: getTimeLabel(), hasConversation: true, lastCreatedAt: createdAtNow }
          : user
      )
    )

    const isRealtimeReady = socketRef.current?.connected || await waitForSocketConnected(TEXT_SEND_WAIT_MS, 200)
    const activeSocket = socketRef.current
    if (isRealtimeReady && activeSocket?.connected) {
      activeSocket.publish({
        destination: '/app/chat.send',
        body: JSON.stringify({
          toUsername: selectedUser.username,
          message: text,
          fromUsername: flow.username,
          tempId,
          type: 'text',
          replyingTo: buildReplyPayload(replyingTo),
          replyText: toReplyText(replyingTo) || null,
          replySenderName: replyingTo?.senderName || null,
          replyMessageId: replyingTo?.messageId || null,
          replyType: replyingTo?.type || null,
          replyMediaUrl: normalizeMediaUrl(replyingTo?.mediaUrl || null),
          replyMimeType: replyingTo?.mimeType || null,
          replyFileName: replyingTo?.fileName || null,
        }),
      })
      if (sendAckTimeoutsRef.current[tempId]) {
        clearTimeout(sendAckTimeoutsRef.current[tempId])
      }
      sendAckTimeoutsRef.current[tempId] = setTimeout(() => {
        setMessages((prev) => prev.map((msg) => (msg.tempId === tempId ? { ...msg, deliveryStatus: 'queued' } : msg)))
        delete sendAckTimeoutsRef.current[tempId]
      }, SEND_ACK_TIMEOUT_MS)
    } else {
      setMessages((prev) => prev.map((msg) => (msg.tempId === tempId ? { ...msg, deliveryStatus: 'queued' } : msg)))
      notify.warn('Realtime is reconnecting. Message queued and will retry automatically.')
    }
  }

  const resizeMessageInput = (inputEl = messageInputRef.current) => {
    if (!(inputEl instanceof HTMLTextAreaElement)) return

    inputEl.style.height = 'auto'

    const computedStyle = window.getComputedStyle(inputEl)
    const lineHeight = parseFloat(computedStyle.lineHeight) || 19
    const paddingTop = parseFloat(computedStyle.paddingTop) || 0
    const paddingBottom = parseFloat(computedStyle.paddingBottom) || 0
    const borderTop = parseFloat(computedStyle.borderTopWidth) || 0
    const borderBottom = parseFloat(computedStyle.borderBottomWidth) || 0
    const minHeight = Math.ceil(lineHeight + paddingTop + paddingBottom + borderTop + borderBottom)
    const maxHeight = Math.ceil((lineHeight * 4) + paddingTop + paddingBottom + borderTop + borderBottom)
    const nextHeight = Math.max(minHeight, Math.min(inputEl.scrollHeight, maxHeight))

    inputEl.style.height = `${nextHeight}px`
    inputEl.style.overflowY = inputEl.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }

  const handleInputChange = (event) => {
    const nextValue = event.target.value
    setInputValue(nextValue)
    resizeMessageInput(event.target)

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

  const handleMessagesScroll = () => {
    setActiveMessageActionsKey(null)
    setReactionTray(null)

    const listEl = messagesAreaRef.current
    if (!listEl) {
      updateScrollToLatestVisibility()
      return
    }
    const distanceFromBottom = getDistanceFromLatest()
    shouldAutoScrollToBottomRef.current = distanceFromBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD
    setShowScrollToLatest(distanceFromBottom > AUTO_SCROLL_BOTTOM_THRESHOLD)

    if (!hasOlderMessages || isLoadingOlderMessages) return
    if (Number(listEl.scrollTop || 0) <= CONVERSATION_SCROLL_TOP_THRESHOLD) {
      loadOlderMessages()
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
      if (socketRef.current?.connected) return true
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
    }
    return Boolean(socketRef.current?.connected)
  }

  const handleSecretTapSend = async ({ text, tempKey, targetRecipients, type = SECRET_TAP_TYPE }) => {
    const senderUsername = String(flow.username || '').trim()
    const normalizedText = String(text || '').trim()
    const uniqueRecipients = Array.from(new Set(
      (Array.isArray(targetRecipients) ? targetRecipients : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    ))

    if (!senderUsername || !normalizedText || !uniqueRecipients.length) {
      return false
    }

    const activePeerUsername = String(selectedUserRef.current?.username || '').trim()
    const activePeerKey = toUserKey(activePeerUsername)
    const createdAtBase = Date.now()
    const outgoingPayloads = uniqueRecipients.map((toUsername, index) => ({
      toUsername,
      tempId: `secret-tap-${tempKey}-${createdAtBase}-${index}`,
      createdAt: createdAtBase + index,
    }))
    const activePayload = activePeerKey
      ? outgoingPayloads.find((row) => toUserKey(row.toUsername) === activePeerKey) || null
      : null

    if (activePayload) {
      shouldAutoScrollToBottomRef.current = true
      setMessages((prev) => trimMessageHistory([...prev, {
        sender: 'user',
        text: normalizedText,
        type,
        timestamp: getTimeLabel(),
        createdAt: activePayload.createdAt,
        clientCreatedAt: activePayload.createdAt,
        senderName: formatUsername(senderUsername || 'You'),
        peerUsername: toUserKey(activePayload.toUsername),
        tempId: activePayload.tempId,
        deliveryStatus: 'uploading',
      }]))
    }

    const isRealtimeReady = socketRef.current?.connected || await waitForSocketConnected(TEXT_SEND_WAIT_MS, 200)
    const activeSocket = socketRef.current

    if (!isRealtimeReady || !activeSocket?.connected) {
      if (activePayload) {
        setMessages((prev) => prev.map((msg) => (
          msg.tempId === activePayload.tempId
            ? { ...msg, deliveryStatus: 'queued' }
            : msg
        )))
        return true
      }
      toast.error('Button Clicking Not Wokring! Wait for 5 sec and try')
      return false
    }

    try {
      outgoingPayloads.forEach(({ toUsername, tempId }) => {
        activeSocket.publish({
          destination: '/app/chat.send',
          body: JSON.stringify({
            toUsername,
            message: normalizedText,
            fromUsername: senderUsername,
            tempId,
            type,
          }),
        })
      })

      if (activePayload) {
        if (sendAckTimeoutsRef.current[activePayload.tempId]) {
          clearTimeout(sendAckTimeoutsRef.current[activePayload.tempId])
        }
        sendAckTimeoutsRef.current[activePayload.tempId] = setTimeout(() => {
          setMessages((prev) => prev.map((msg) => (
            msg.tempId === activePayload.tempId
              ? { ...msg, deliveryStatus: 'queued' }
              : msg
          )))
          delete sendAckTimeoutsRef.current[activePayload.tempId]
        }, SEND_ACK_TIMEOUT_MS)
      }

      return true
    } catch (error) {
      console.error('Realtime publish failed for secret tap', error)
      if (activePayload) {
        setMessages((prev) => prev.map((msg) => (
          msg.tempId === activePayload.tempId
            ? { ...msg, deliveryStatus: 'queued' }
            : msg
        )))
        return true
      }
      toast.error('Button Clicking Not Wokring! Wait for 5 sec and try')
      return false
    }
  }

  const sendMediaFile = async (file, type) => {
    if (!selectedUser || !file) return false

    let resolvedType = type
    if (type === 'photo') {
      resolvedType = inferMediaKind(file)
    }

    const currentReply = replyingTo
    const targetUser = selectedUser
    const tempId = createTempId()
    const createdAtNow = Date.now()
    const label = resolvedType === 'voice' ? 'voice message' : resolvedType
    const article = resolvedType === 'image' || resolvedType === 'audio' ? 'an' : 'a'
    const maxBytes = MAX_MEDIA_BYTES
    const needsCompression = file.size > maxBytes
    const localPreviewUrl = URL.createObjectURL(file)

    const updateTempMessage = (patch) => {
      setMessages((prev) => prev.map((msg) => (
        msg.tempId === tempId ? { ...msg, ...patch } : msg
      )))
    }

    setMessages((prev) => trimMessageHistory([...prev, {
      sender: 'user',
      type: resolvedType,
      mediaType: resolvedType,
      text: `Sent ${article} ${label}`,
      fileName: file.name,
      mediaUrl: localPreviewUrl,
      mimeType: file.type,
      timestamp: getTimeLabel(),
      createdAt: createdAtNow,
      clientCreatedAt: createdAtNow,
      senderName: formatUsername(flow.username || 'You'),
      peerUsername: toUserKey(targetUser.username),
      replyingTo: currentReply,
      tempId,
      deliveryStatus: 'uploading',
      uploadPhase: needsCompression ? 'compressing' : 'uploading',
      uploadProgress: needsCompression ? 1 : 0,
    }]))
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
        toUserKey(user.username) === toUserKey(targetUser.username)
          ? { ...user, lastMessage: previewLabel, timestamp: getTimeLabel(), hasConversation: true, lastCreatedAt: Date.now() }
          : user
      )
    )

    let uploadFile = file
    if (needsCompression) {
      notify.info(`Large media detected. Compressing to fit ${MAX_MEDIA_MB}MB limit...`)
      const compressedResult = await compressMediaToLimit(uploadFile, resolvedType, maxBytes, (progress) => {
        updateTempMessage({
          uploadPhase: 'compressing',
          uploadProgress: Math.max(1, Math.min(100, Number(progress || 0))),
        })
      })
      if (!compressedResult?.file) {
        updateTempMessage({ deliveryStatus: 'failed', uploadProgress: 100 })
        notify.error(`Upload must be below ${MAX_MEDIA_MB}MB. Compression could not reduce this media enough.`)
        return false
      }
      uploadFile = compressedResult.file
      updateTempMessage({
        fileName: uploadFile.name,
        mimeType: uploadFile.type || file.type,
        uploadPhase: 'uploading',
        uploadProgress: 0,
      })
      if (compressedResult.compressed) {
        const beforeMb = Math.round(file.size / (1024 * 1024))
        const afterMb = Math.round(uploadFile.size / (1024 * 1024))
        notify.info(`Compressed media from ${beforeMb}MB to ${afterMb}MB`)
      }
    }

    if (uploadFile.size > maxBytes) {
      updateTempMessage({ deliveryStatus: 'failed', uploadProgress: 100 })
      notify.error(`Upload must be below ${MAX_MEDIA_MB}MB.`)
      return false
    }

    let uploaded
    try {
      uploaded = await uploadMedia(flow.token, uploadFile, {
        mediaKind: resolvedType,
        onProgress: (progress) => {
          updateTempMessage({
            uploadPhase: 'uploading',
            uploadProgress: Math.max(1, Math.min(100, Number(progress || 0))),
          })
        },
      })
    } catch (error) {
      console.error('Media upload failed', error)
      if (error?.response?.status === 401) {
        notify.error('Session expired. Please login again.')
        resetFlowState(setFlow)
        navigate('/auth')
        return false
      }
      if (error?.response?.status === 413) {
        updateTempMessage({ deliveryStatus: 'failed', uploadProgress: 100 })
        notify.error(`File exceeds upload limit (${MAX_MEDIA_MB}MB max).`)
        return false
      }
      updateTempMessage({ deliveryStatus: 'failed', uploadProgress: 100 })
      notify.error('Media upload failed. Please try a smaller file.')
      return false
    }

    const uploadedUrl = normalizeMediaUrl(uploaded?.mediaUrl || localPreviewUrl)
    const uploadedMime = uploaded?.mimeType || uploadFile.type || null
    const uploadedFileName = uploaded?.fileName || uploadFile.name
    const uploadedMediaType = uploaded?.mediaType || resolvedType

    setMessages((prev) => prev.map((msg) => (
      msg.tempId === tempId
        ? {
            ...msg,
            mediaUrl: uploadedUrl,
            mediaType: uploadedMediaType,
            mimeType: uploadedMime,
            fileName: uploadedFileName,
            uploadPhase: 'uploading',
            uploadProgress: 100,
          }
        : msg
    )))

    const isRealtimeReady = await waitForSocketConnected(MEDIA_SEND_WAIT_MS, 200)
    if (!isRealtimeReady) {
      updateTempMessage({ deliveryStatus: 'queued' })
      notify.warn('Media uploaded. Realtime is reconnecting, send is queued.')
      return true
    }

    try {
      const activeSocket = socketRef.current
      if (!activeSocket?.connected) {
        updateTempMessage({ deliveryStatus: 'queued' })
        notify.warn('Media uploaded. Realtime is reconnecting, send is queued.')
        return true
      }
      activeSocket.publish({
        destination: '/app/chat.send',
        body: JSON.stringify({
          toUsername: targetUser.username,
          fromUsername: flow.username,
          message: previewLabel,
          tempId,
          type: resolvedType,
          mediaType: uploadedMediaType,
          fileName: uploadedFileName,
          mediaUrl: uploadedUrl,
          mimeType: uploadedMime,
          replyingTo: buildReplyPayload(currentReply),
          replyText: toReplyText(currentReply) || null,
          replySenderName: currentReply?.senderName || null,
          replyMessageId: currentReply?.messageId || null,
          replyType: currentReply?.type || null,
          replyMediaUrl: normalizeMediaUrl(currentReply?.mediaUrl || null),
          replyMimeType: currentReply?.mimeType || null,
          replyFileName: currentReply?.fileName || null,
        }),
      })
      if (sendAckTimeoutsRef.current[tempId]) {
        clearTimeout(sendAckTimeoutsRef.current[tempId])
      }
      sendAckTimeoutsRef.current[tempId] = setTimeout(() => {
        setMessages((prev) => prev.map((msg) => (msg.tempId === tempId ? { ...msg, deliveryStatus: 'queued' } : msg)))
        delete sendAckTimeoutsRef.current[tempId]
      }, SEND_ACK_TIMEOUT_MS)
    } catch (error) {
      console.error('Realtime publish failed after upload', error)
      updateTempMessage({ deliveryStatus: 'queued' })
      notify.warn('Media uploaded. Realtime send will retry when connection is back.')
      return true
    }
    return true
  }

  const handleFileUpload = async (event, type) => {
    const file = event?.target?.files?.[0]
    if (!file) return

    if (!selectedUser) {
      notify.error('Select a user first.')
      if (event?.target) {
        event.target.value = ''
      }
      return
    }

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

  const queueCapturedPhotoToChat = async (file) => {
    if (!file) return false
    const didQueue = await sendMediaFile(file, 'photo')
    if (didQueue) {
      return true
    }
    clearPendingImagePreview()
    const previewUrl = URL.createObjectURL(file)
    setPendingImagePreview({ file, url: previewUrl, name: file.name || 'image' })
    return false
  }

  const handleCameraPhotoInputChange = async (event) => {
    const file = event?.target?.files?.[0]
    if (!file) return

    if (!selectedUser) {
      notify.error('Select a user first.')
      if (event?.target) {
        event.target.value = ''
      }
      return
    }

    try {
      await queueCapturedPhotoToChat(file)
    } catch (error) {
      console.error('Camera photo input error:', error)
      notify.error('Failed to process the photo.')
    } finally {
      if (event?.target) {
        event.target.value = ''
      }
    }
  }

  const confirmImagePreviewSend = async () => {
    if (!pendingImagePreview?.file) return
    if (!selectedUser) {
      notify.error('Select a user first.')
      return
    }
    if (isPendingImageSending) return
    const file = pendingImagePreview.file
    setIsPendingImageSending(true)
    try {
      const didQueue = await sendMediaFile(file, 'photo')
      if (didQueue) {
        clearPendingImagePreview()
      }
    } finally {
      setIsPendingImageSending(false)
    }
  }

  const stopVoiceRecording = (discard = false) => {
    discardRecordingRef.current = Boolean(discard)
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    } else {
      discardRecordingRef.current = false
      setIsRecordingVoice(false)
      setRecordingSeconds(0)
      stopRecordingTimer()
      stopRecordingStream()
      mediaRecorderRef.current = null
    }
  }

  const cancelVoiceRecording = () => {
    stopVoiceRecording(true)
  }

  const startVoiceRecording = async () => {
    if (!selectedUser) {
      notify.error('Select a user first.')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      notify.error('Voice recording is not supported on this browser.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const preferredMimeTypes = isIosPlatform
        ? [
            'audio/mp4;codecs=mp4a.40.2',
            'audio/mp4',
            'audio/aac',
            'audio/mpeg',
            'audio/webm;codecs=opus',
            'audio/webm',
          ]
        : [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/mp4;codecs=mp4a.40.2',
            'audio/mp4',
            'audio/aac',
            'audio/mpeg',
          ]
      const supportedMimeType = preferredMimeTypes.find((mime) => MediaRecorder.isTypeSupported?.(mime))

      const recorder = supportedMimeType
        ? new MediaRecorder(stream, { mimeType: supportedMimeType })
        : new MediaRecorder(stream)

      recordingChunksRef.current = []
      discardRecordingRef.current = false
      recordingStreamRef.current = stream
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordingChunksRef.current.push(event.data)
        }
      }

      recorder.onerror = () => {
        notify.error('Voice recording failed.')
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

        const discardRecording = Boolean(discardRecordingRef.current)
        discardRecordingRef.current = false
        if (discardRecording) return
        if (!chunks.length) return
        const recordedChunkType = chunks.find((chunk) => chunk?.type)?.type || ''
        const blobType = recorder.mimeType || recordedChunkType || 'audio/mp4'
        const blob = new Blob(chunks, { type: blobType })
        const extension = blobType.includes('webm') ? 'webm' : 'm4a'
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
      notify.error('Microphone permission denied or unavailable.')
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
    if (!isMessageRetryable(message)) return
    const selectedPeerKey = toUserKey(selectedUser.username)
    const messagePeerKey = toUserKey(message.peerUsername)
    if (!messagePeerKey || messagePeerKey !== selectedPeerKey) {
      notify.error('Open the same chat to resend this message.')
      return
    }
    const activeSocket = socketRef.current
    if (!activeSocket?.connected) {
      notify.warn('Realtime is reconnecting. Message is queued.')
      return
    }

    const messageKey = getMessageEditKey(message)
    const type = message.type || 'text'
    const mediaUrl = message.mediaUrl || null
    if (type !== 'text' && (!mediaUrl || String(mediaUrl).startsWith('blob:'))) {
      notify.error('Cannot resend local media. Please upload the file again.')
      return
    }

    const nextTempId = message.tempId || createTempId()
    setMessages((prev) => prev.map((msg) => (
      isSameMessage(msg, messageKey)
        ? { ...msg, tempId: nextTempId, peerUsername: selectedPeerKey, deliveryStatus: 'uploading' }
        : msg
    )))

    activeSocket.publish({
      destination: '/app/chat.send',
      body: JSON.stringify({
        toUsername: selectedUser.username,
        fromUsername: flow.username,
        message: message.text || '',
        tempId: nextTempId,
        type,
        mediaType: message.mediaType || type,
        fileName: message.fileName || null,
        mediaUrl,
        mimeType: message.mimeType || null,
        replyingTo: buildReplyPayload(message.replyingTo),
        replyText: toReplyText(message.replyingTo) || null,
        replySenderName: message.replyingTo?.senderName || null,
        replyMessageId: message.replyingTo?.messageId || null,
        replyType: message.replyingTo?.type || null,
        replyMediaUrl: normalizeMediaUrl(message.replyingTo?.mediaUrl || null),
        replyMimeType: message.replyingTo?.mimeType || null,
        replyFileName: message.replyingTo?.fileName || null,
      }),
    })
    if (sendAckTimeoutsRef.current[nextTempId]) {
      clearTimeout(sendAckTimeoutsRef.current[nextTempId])
    }
    sendAckTimeoutsRef.current[nextTempId] = setTimeout(() => {
      setMessages((prev) => prev.map((msg) => (msg.tempId === nextTempId ? { ...msg, deliveryStatus: 'queued' } : msg)))
      delete sendAckTimeoutsRef.current[nextTempId]
    }, SEND_ACK_TIMEOUT_MS)
  }

  const retryQueuedMessages = (targetPeerUsername = null) => {
    const activeSocket = socketRef.current
    if (!activeSocket?.connected) return
    const targetPeerKey = targetPeerUsername ? toUserKey(targetPeerUsername) : ''
    const retryableRows = (messagesRef.current || [])
      .filter((msg) => (
        msg?.sender === 'user'
        && msg?.deliveryStatus === 'queued'
        && msg?.tempId
        && (!targetPeerKey || toUserKey(msg?.peerUsername) === targetPeerKey)
      ))
      .slice(-12)

    if (!retryableRows.length) return false

    for (const msg of retryableRows) {
      const retryTempId = msg.tempId
      const type = msg.type || 'text'
      const mediaUrl = msg.mediaUrl || null
      const canRetryWithoutMedia = type === 'text' || isSecretTapMessageType(type)
      const peerUsername = String(msg.peerUsername || targetPeerUsername || '').trim()
      if (!peerUsername) {
        continue
      }
      if (!canRetryWithoutMedia && (!mediaUrl || String(mediaUrl).startsWith('blob:'))) {
        continue
      }

      setMessages((prev) => prev.map((row) => (
        row?.tempId === retryTempId
          ? { ...row, deliveryStatus: 'uploading', peerUsername: toUserKey(peerUsername) }
          : row
      )))

      if (sendAckTimeoutsRef.current[retryTempId]) {
        clearTimeout(sendAckTimeoutsRef.current[retryTempId])
      }
      sendAckTimeoutsRef.current[retryTempId] = setTimeout(() => {
        setMessages((prev) => prev.map((row) => (
          row?.tempId === retryTempId ? { ...row, deliveryStatus: 'queued' } : row
        )))
        delete sendAckTimeoutsRef.current[retryTempId]
      }, SEND_ACK_TIMEOUT_MS)

      activeSocket.publish({
        destination: '/app/chat.send',
        body: JSON.stringify({
          toUsername: peerUsername,
          fromUsername: flow.username,
          message: msg.text || '',
          tempId: retryTempId,
          type,
          mediaType: msg.mediaType || type,
          fileName: msg.fileName || null,
          mediaUrl,
          mimeType: msg.mimeType || null,
          replyingTo: buildReplyPayload(msg.replyingTo),
          replyText: toReplyText(msg.replyingTo) || null,
          replySenderName: msg.replyingTo?.senderName || null,
          replyMessageId: msg.replyingTo?.messageId || null,
          replyType: msg.replyingTo?.type || null,
          replyMediaUrl: normalizeMediaUrl(msg.replyingTo?.mediaUrl || null),
          replyMimeType: msg.replyingTo?.mimeType || null,
          replyFileName: msg.replyingTo?.fileName || null,
        }),
      })
    }
    return true
  }

  useEffect(() => {
    if (!socket?.connected) return
    retryQueuedMessages(selectedUser?.username || null)
  }, [socket?.connected, selectedUser?.username, flow.username])

  useEffect(() => {
    if (!socket?.connected) return
    const retryTimer = setInterval(() => {
      retryQueuedMessages()
    }, 8000)
    return () => {
      clearInterval(retryTimer)
    }
  }, [socket?.connected, selectedUser?.username, flow.username])

  const handleStartEdit = (message) => {
    if (!canEditMessage(message)) {
      notify.error('Message can only be edited within 15 minutes.')
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

  const handleReplyReferenceJump = async (event, reply) => {
    event.preventDefault()
    event.stopPropagation()
    if (!reply || !selectedUser) return

    let targetKey = findReplyTargetKey(reply)
    let attempts = MISSED_SCAN_PAGE_LIMIT

    while (!targetKey && hasOlderMessagesRef.current && attempts > 0) {
      attempts -= 1
      await loadOlderMessages()
      await new Promise((resolve) => window.requestAnimationFrame(resolve))
      targetKey = findReplyTargetKey(reply)
    }

    if (!targetKey) {
      notify.info('Original message could not be found in this chat.')
      return
    }

    shouldAutoScrollToBottomRef.current = false
    scrollToMessageKey(targetKey, 'smooth')
  }

  const blockReplyReferenceGesture = (event) => {
    if (!event) return
    event.stopPropagation()
  }

  const handleDeleteMessage = (message) => {
    if (!selectedUser || !message) return
    setPendingDeleteMessage(message)
    setShowDeleteConfirm(true)
    setActiveMessageActionsKey(null)
  }

  const performDeleteMessage = (message) => {
    if (!selectedUser || !message) {
      setShowDeleteConfirm(false)
      setPendingDeleteMessage(null)
      return
    }
    const messageKey = getMessageEditKey(message)
    if (!messageKey) {
      setShowDeleteConfirm(false)
      setPendingDeleteMessage(null)
      return
    }

    const hasServerIdentity = Number(message?.messageId || 0) > 0
    if (hasServerIdentity) {
      const activeSocket = socketRef.current
      if (!activeSocket?.connected) {
        notify.error('Realtime server disconnected. Delete failed.')
        setShowDeleteConfirm(false)
        setPendingDeleteMessage(null)
        return
      }
      activeSocket.publish({
        destination: '/app/chat.delete',
        body: JSON.stringify({
          messageId: message.messageId,
          fromUsername: flow.username,
        }),
      })
    }

    setMessages((prev) => {
      const next = hasServerIdentity
        ? prev.filter((msg) => Number(msg?.messageId || 0) !== Number(message.messageId || 0))
        : prev.filter((msg) => !isSameMessage(msg, messageKey))
      if (next.length !== prev.length) {
        syncConversationSummaryForUser(selectedUser.username, next)
      }
      return next
    })
    setReplyingTo((prev) => (prev && isSameMessage(prev, messageKey) ? null : prev))
    setEditingMessage((prev) => (prev?.key === messageKey ? null : prev))
    setReactionTray((prev) => (prev?.messageKey === messageKey ? null : prev))
    setActiveMessageActionsKey((prev) => (prev === messageKey ? null : prev))
    setShowDeleteConfirm(false)
    setPendingDeleteMessage(null)
  }

  const confirmDeleteMessage = () => {
    performDeleteMessage(pendingDeleteMessage)
  }

  const handleDragStart = (event, message) => {
    draggedMessageRef.current = message
    setDraggedMessage(message)
    setIsDraggingMessage(true)
    event.dataTransfer.effectAllowed = 'copy'
    try {
      event.dataTransfer.setData('text/plain', String(message?.id || message?.tempId || message?.clientId || message?.text || 'reply'))
    } catch {
      // Some environments restrict drag payloads; the ref fallback still preserves the dragged message.
    }
  }

  const handleDragOver = (event) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleDragEnd = () => {
    draggedMessageRef.current = null
    setIsDraggingMessage(false)
    setDraggedMessage(null)
  }

  const resetMessageSwipe = () => {
    setSwipingMessage((prev) => (prev.key || prev.offset ? { key: null, offset: 0 } : prev))
  }

  const triggerReplySwipe = (message) => {
    if (!message || isMessageRetryable(message)) return
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(18)
      }
    })
    setReplyingTo(message)
    setActiveMessageActionsKey(null)
    swipeTapSuppressUntilRef.current = Date.now() + 420
  }

  const handleDrop = (event) => {
    event.preventDefault()
    const message = draggedMessageRef.current || draggedMessage
    if (!message) return
    setReplyingTo(message)
    draggedMessageRef.current = null
    setDraggedMessage(null)
    setIsDraggingMessage(false)
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
      offset: 0,
      moved: false,
      triggered: false,
      swiped: false,
    }
    resetMessageSwipe()
  }

  const handleMessagePointerDown = (event, message, messageKey) => {
    if (!isTouchDevice) return
    if (event.pointerType && event.pointerType !== 'touch') return
    beginTouchMessageGesture(event.clientX, event.clientY, event.target, message, messageKey)
  }

  const handleMessageTouchStart = (event, message, messageKey) => {
    if (!isTouchDevice) return
    if (typeof window !== 'undefined' && 'PointerEvent' in window) return
    const touch = event.touches?.[0]
    if (!touch) return
    beginTouchMessageGesture(touch.clientX, touch.clientY, event.target, message, messageKey)
  }

  const handleMessageGestureMove = (x, y, sourceEvent = null) => {
    const state = messageLongPressRef.current
    if (!state?.message) return
    const dx = x - state.startX
    const dy = y - state.startY

    if (state.timerId && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      clearTimeout(state.timerId)
      messageLongPressRef.current.timerId = null
    }

    if (Math.abs(dy) > MESSAGE_REPLY_SWIPE_CANCEL_Y_PX && Math.abs(dy) > Math.abs(dx) + 8) {
      resetMessageSwipe()
      messageLongPressRef.current = { timerId: null, key: null, message: null, startX: 0, startY: 0, offset: 0, moved: true, triggered: false, swiped: false }
      return
    }

    const isOutgoing = state.message?.sender === 'user'
    const rawSwipeOffset = isOutgoing ? -dx : dx
    const swipeOffset = Math.max(0, Math.min(MESSAGE_REPLY_SWIPE_MAX_PX, rawSwipeOffset))
    const replyTriggerPx = isOutgoing ? MESSAGE_REPLY_SWIPE_TRIGGER_OUTGOING_PX : MESSAGE_REPLY_SWIPE_TRIGGER_PX
    const armed = !isMessageFailed(state.message) && Math.abs(dy) < 38 && swipeOffset >= replyTriggerPx

    if (swipeOffset > 0 && Math.abs(dy) < 52) {
      if (sourceEvent?.cancelable && Math.abs(dx) > Math.abs(dy)) {
        sourceEvent.preventDefault()
      }
      messageLongPressRef.current.offset = swipeOffset
      setSwipingMessage((prev) => (
        prev.key === state.key && prev.offset === swipeOffset
          ? prev
          : { key: state.key, offset: swipeOffset }
      ))
    } else if (state.offset || swipingMessage.key === state.key) {
      messageLongPressRef.current.offset = 0
      resetMessageSwipe()
    }

    messageLongPressRef.current.moved = Math.abs(dx) > 8 || Math.abs(dy) > 8
  }

  const handleMessagePointerMove = (event) => {
    if (!isTouchDevice) return
    if (event.pointerType && event.pointerType !== 'touch') return
    handleMessageGestureMove(event.clientX, event.clientY, event)
  }

  const handleMessageTouchMove = (event) => {
    if (!isTouchDevice) return
    if (typeof window !== 'undefined' && 'PointerEvent' in window) return
    const touch = event.touches?.[0]
    if (!touch) return
    handleMessageGestureMove(touch.clientX, touch.clientY, event)
  }

  const finishMessageGesture = () => {
    const state = messageLongPressRef.current
    if (state?.timerId) {
      clearTimeout(state.timerId)
    }
    const replyTriggerPx = state?.message?.sender === 'user' ? MESSAGE_REPLY_SWIPE_TRIGGER_OUTGOING_PX : MESSAGE_REPLY_SWIPE_TRIGGER_PX
    const shouldReply = Boolean(state?.message) && !state?.swiped && state.offset >= replyTriggerPx
    const message = state?.message || null
    resetMessageSwipe()
    messageLongPressRef.current = { timerId: null, key: null, message: null, startX: 0, startY: 0, offset: 0, moved: false, triggered: false, swiped: shouldReply }
    if (shouldReply) {
      triggerReplySwipe(message)
    }
  }

  const handleMessagePointerEnd = (event) => {
    if (event?.pointerType && event.pointerType !== 'touch') return
    finishMessageGesture()
  }

  const handleMessageTouchEnd = () => {
    if (typeof window !== 'undefined' && 'PointerEvent' in window) return
    finishMessageGesture()
  }

  const clearPendingMessageTap = () => {
    const timerId = lastMessageTapRef.current?.timerId
    if (timerId) {
      clearTimeout(timerId)
    }
    lastMessageTapRef.current = { key: null, at: 0, count: 0, timerId: null }
  }

  const handleMessageTap = (event, message, messageKey) => {
    if (!isTouchDevice) return
    if (Date.now() < swipeTapSuppressUntilRef.current) return
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (target.closest('button, a, audio, video, input, textarea')) return

    const now = Date.now()
    const lastTap = lastMessageTapRef.current
    if (activeMessageActionsKey === messageKey || reactionTray?.messageKey === messageKey) {
      setReactionTray(null)
      setActiveMessageActionsKey(null)
    }

    const isSameTapSequence = lastTap.key === messageKey && (now - lastTap.at) <= 320
    const nextCount = isSameTapSequence ? Math.min(3, Number(lastTap.count || 0) + 1) : 1

    if (lastTap.timerId) {
      clearTimeout(lastTap.timerId)
    }

    if (nextCount >= 3) {
      clearPendingMessageTap()
      handleDeleteMessage(message)
      return
    }

    const timerId = window.setTimeout(() => {
      if (nextCount === 2) {
        triggerReplySwipe(message)
      }
      clearPendingMessageTap()
    }, 320)

    lastMessageTapRef.current = { key: messageKey, at: now, count: nextCount, timerId }
  }

  useEffect(() => () => {
    clearPendingMessageTap()
  }, [])

  const getMessageOverlayMetrics = (message, messageKey, messageFailed = false) => {
    if (typeof window === 'undefined' || !messageKey) {
      return { actionPlacement: 'below', messageRect: null }
    }
    const messageNode = messageNodeMapRef.current?.[messageKey]
    const bubbleNode = messageNode?.querySelector?.('.message-content') || null
    const messageRect = bubbleNode?.getBoundingClientRect?.() || messageNode?.getBoundingClientRect?.() || null
    if (!messageRect) {
      return { actionPlacement: 'below', messageRect: null }
    }
    const messagesAreaRect = messagesAreaRef.current?.getBoundingClientRect?.() || null
    const boundsTop = messagesAreaRect ? Math.max(0, messagesAreaRect.top) : 0
    const boundsBottom = messagesAreaRect
      ? Math.min(window.innerHeight, messagesAreaRect.bottom)
      : window.innerHeight
    const bottomSpace = Math.max(0, boundsBottom - messageRect.bottom)
    const topSpace = Math.max(0, messageRect.top - boundsTop)
    const actionCount = 3 + ((message?.sender === 'user' && (messageFailed || canEditMessage(message))) ? 1 : 0)
    const actionButtonHeightPx = isTouchDevice ? 46 : 36
    const actionCardHeightPx = isTouchDevice
      ? (12 + (actionCount * actionButtonHeightPx))
      : 132
    const menuOffsetFromBubblePx = isTouchDevice ? 64 : 10
    const requiredSpacePx = actionCardHeightPx + menuOffsetFromBubblePx
    const actionPlacement = bottomSpace >= requiredSpacePx
      ? 'below'
      : (topSpace >= requiredSpacePx ? 'above' : (bottomSpace >= topSpace ? 'below' : 'above'))
    return { actionPlacement, messageRect }
  }

  const getReactionTrayStyle = () => {
    if (!reactionTray || typeof window === 'undefined') return {}
    const trayMessage = getReactionTrayMessage()
    const trayWidth = 292
    const trayHeight = 48
    const trayGapFromMessagePx = 8
    const pad = 8
    const overlayMetrics = trayMessage
      ? getMessageOverlayMetrics(trayMessage.message, trayMessage.messageKey, trayMessage.messageFailed)
      : null
    const messageRect = overlayMetrics?.messageRect || null
    const anchorX = messageRect
      ? (messageRect.left + (messageRect.width / 2))
      : reactionTray.x
    const left = Math.max(
      pad,
      Math.min(window.innerWidth - trayWidth - pad, anchorX - (trayWidth / 2))
    )
    const anchorTop = messageRect ? messageRect.top : reactionTray.y
    const anchorBottom = messageRect ? messageRect.bottom : reactionTray.y
    const actionPlacement = overlayMetrics?.actionPlacement || 'below'
    const top = isTouchDevice
      ? (
          actionPlacement === 'above'
            ? Math.max(pad, anchorTop - trayGapFromMessagePx - trayHeight)
            : Math.max(pad, Math.min(window.innerHeight - trayHeight - pad, anchorBottom + trayGapFromMessagePx))
        )
      : Math.max(pad, anchorTop - trayHeight - 10)
    return { left: `${left}px`, top: `${top}px` }
  }

  const getReactionTrayMessage = () => {
    const messageKey = reactionTray?.messageKey || activeMessageActionsKey
    if (!messageKey) return null
    const index = messages.findIndex((msg, idx) => getMessageUiKey(msg, idx) === messageKey)
    if (index < 0) return null
    return {
      messageKey,
      message: messages[index],
      messageFailed: isMessageRetryable(messages[index]),
    }
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
        notify.error('Reaction will sync after the message is sent.')
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

  const handleCustomReactionPress = () => {
    if (!reactionTray?.messageKey || typeof window === 'undefined') return
    applyMessageReaction(reactionTray.messageKey, PLACEHOLDER_REACTION_EMOJI)
  }

  const isCurrentChatUser = (username) => {
    const normalized = toUserKey(String(username || '').replace(/^@+/, '').trim())
    const me = toUserKey(flow.username || '')
    return Boolean(normalized && me && normalized === me)
  }

  const getReplyContextLabel = (message) => (
    isCurrentChatUser(message?.replyingTo?.senderName)
      ? 'Replied to you'
      : 'Replied to him'
  )

  const getComposerReplyLabel = (reply) => (
    isCurrentChatUser(reply?.senderName)
      ? 'Replying to you'
      : 'Replying to him'
  )

  const renderMessageReplyContext = (message) => {
    if (!message?.replyingTo) return null
    const isReplyingToYou = isCurrentChatUser(message.replyingTo?.senderName)
    return (
      <div className={`message-reply-context ${isReplyingToYou ? 'reply-target-you' : 'reply-target-other'}`}>
        <div className="reply-label message-reply-label">{getReplyContextLabel(message)}</div>
        <div className="message-reply-quote">
          <span className="message-reply-quote-bar" aria-hidden="true" />
          <div className="reply-text message-reply-quote-content">{renderReplyContent(message.replyingTo, 'bubble')}</div>
        </div>
      </div>
    )
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
              <video
                className="message-video-thumb-video"
                src={message.mediaUrl}
                preload="metadata"
                muted
                playsInline
              />
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
        <button
          type="button"
          className="message-file-preview"
          onClick={() => triggerFileDownload(message.mediaUrl, message.fileName || 'attachment')}
        >
          {message.fileName || 'Download file'}
        </button>
      )
    }
    return null
  }

  const handleCameraPhotoCapture = async () => {
    if (!selectedUser) {
      notify.error('Select a user first.')
      return
    }
    if (isCameraLoading) return
    
    const isNativeRuntime = isNativeCapacitorRuntime()
    if (!isNativeRuntime) {
      cameraPhotoInputRef.current?.click()
      return
    }

    setIsCameraLoading(true)
    try {
      const hasPermission = await requestNativeCameraPermission()
      if (!hasPermission) return

      const toFileFromBlob = (blob, name, typeHint = '') => {
        const safeType = String(blob?.type || typeHint || '').trim()
        return new File([blob], name, {
          type: safeType || 'application/octet-stream',
          lastModified: Date.now(),
        })
      }
      const base64ToBlob = (base64Data, mimeType) => {
        const binary = window.atob(base64Data)
        const len = binary.length
        const bytes = new Uint8Array(len)
        for (let i = 0; i < len; i += 1) {
          bytes[i] = binary.charCodeAt(i)
        }
        return new Blob([bytes], { type: mimeType || 'application/octet-stream' })
      }
      const readNativePathBlob = async (path, mimeType) => {
        const pathText = String(path || '').trim()
        if (!pathText) return null
        try {
          const read = await Filesystem.readFile({ path: pathText })
          const rawData = read?.data
          if (!rawData) return null
          if (rawData instanceof Blob) return rawData
          const base64Data = String(rawData).split(',').pop() || ''
          if (!base64Data) return null
          return base64ToBlob(base64Data, mimeType)
        } catch {
          return null
        }
      }
      const photo = await Camera.getPhoto({
        source: CameraSource.Camera,
        resultType: CameraResultType.Uri,
        quality: 90,
        saveToGallery: false,
        correctOrientation: true,
      })
      const rawFormat = String(photo?.format || '').trim().toLowerCase()
      const extension = rawFormat || 'jpg'
      const fileType = `image/${extension === 'jpg' ? 'jpeg' : extension}`
      let blob = await readNativePathBlob(photo?.path, fileType)
      if (!blob) {
        const webPath = String(photo?.webPath || '').trim()
        if (!webPath) throw new Error('camera-photo-path-missing')
        const response = await fetch(webPath)
        if (!response.ok) throw new Error(`camera-fetch-failed-${response.status}`)
        blob = await response.blob()
      }
      const file = toFileFromBlob(blob, `camera-${Date.now()}.${extension}`, fileType)
      await queueCapturedPhotoToChat(file)
    } catch (error) {
      const code = String(error?.message || '').toLowerCase()
      const cancelled = code.includes('cancel') || code.includes('user cancelled')
      if (!cancelled) {
        notify.error('Unable to open camera.')
      }
    } finally {
      setIsCameraLoading(false)
    }
  }

  useEffect(() => {
    resizeMessageInput()
  }, [inputValue, editingMessage?.key, selectedUser?.username])

  // DISABLED: Snap Camera feature
  // const openSnapCamera = () => {
  //   if (!selectedUser) {
  //     notify.error('Select a user first.')
  //     return
  //   }
  //   setShowAttachMenu(false)
  //   setIsSnapCameraOpen(true)
  // }

  const handleCameraVideoCapture = async () => {
    if (!selectedUser) {
      notify.error('Select a user first.')
      return
    }
    if (isCameraLoading) return
    
    const isNativeRuntime = isNativeCapacitorRuntime()
    if (!isNativeRuntime) {
      cameraVideoInputRef.current?.click()
      return
    }

    setIsCameraLoading(true)
    try {
      const hasPermission = await requestNativeCameraPermission()
      if (!hasPermission) return

      const toFileFromBlob = (blob, name, typeHint = '') => {
        const safeType = String(blob?.type || typeHint || '').trim()
        return new File([blob], name, {
          type: safeType || 'application/octet-stream',
          lastModified: Date.now(),
        })
      }
      const base64ToBlob = (base64Data, mimeType) => {
        const binary = window.atob(base64Data)
        const len = binary.length
        const bytes = new Uint8Array(len)
        for (let i = 0; i < len; i += 1) {
          bytes[i] = binary.charCodeAt(i)
        }
        return new Blob([bytes], { type: mimeType || 'application/octet-stream' })
      }
      const readNativePathBlob = async (path, mimeType) => {
        const pathText = String(path || '').trim()
        if (!pathText) return null
        try {
          const read = await Filesystem.readFile({ path: pathText })
          const rawData = read?.data
          if (!rawData) return null
          if (rawData instanceof Blob) return rawData
          const base64Data = String(rawData).split(',').pop() || ''
          if (!base64Data) return null
          return base64ToBlob(base64Data, mimeType)
        } catch {
          return null
        }
      }

      // Use Capacitor Camera API for consistent video capture on iOS and Android
      const video = await Camera.getPhoto({
        source: CameraSource.Camera,
        resultType: CameraResultType.Uri,
        quality: 85,
        saveToGallery: false,
        correctOrientation: true,
      })

      const rawFormat = String(video?.format || '').trim().toLowerCase()
      const extension = rawFormat || 'mp4'
      const fileType = `video/${extension === 'mov' ? 'quicktime' : extension}`
      let blob = await readNativePathBlob(video?.path, fileType)
      if (!blob) {
        const webPath = String(video?.webPath || '').trim()
        if (!webPath) throw new Error('video-capture-path-missing')
        const response = await fetch(webPath)
        if (!response.ok) throw new Error(`video-capture-fetch-failed-${response.status}`)
        blob = await response.blob()
      }
      const file = toFileFromBlob(blob, `camera-video-${Date.now()}.${extension}`, fileType)
      await sendMediaFile(file, 'video')
    } catch (error) {
      const code = String(error?.message || '').toLowerCase()
      const cancelled = code.includes('cancel') || code.includes('user cancelled')
      if (!cancelled) {
        notify.error('Unable to capture video.')
      }
    } finally {
      setIsCameraLoading(false)
    }
  }
  const renderReplyContent = (reply, scope = 'bubble') => {
    if (!reply) return null
    const replyType = String(reply.type || '').toLowerCase()
    const replyMediaUrl = normalizeMediaUrl(reply.mediaUrl || null)
    const canPreviewMedia = (replyType === 'image' || replyType === 'video') && Boolean(replyMediaUrl)
    const canJumpToReply = scope === 'bubble' && Boolean(
      reply.messageId || reply.text || reply.mediaUrl || reply.fileName
    )

    if (!canPreviewMedia) {
      const plainContent = <>{renderTextWithLinks(toReplyText(reply))}</>
      if (!canJumpToReply) return plainContent
      return (
        <button
          type="button"
          className="reply-reference-button"
          onPointerDown={blockReplyReferenceGesture}
          onTouchStart={blockReplyReferenceGesture}
          onMouseDown={blockReplyReferenceGesture}
          onClick={(event) => handleReplyReferenceJump(event, reply)}
        >
          {plainContent}
        </button>
      )
    }

    const videoThumb = replyType === 'video' ? (videoThumbMap[replyMediaUrl] || null) : null
    const mediaContent = (
      <span className={`reply-media-preview ${scope}`}>
        <span className={`reply-media-thumb ${replyType}`}>
          {replyType === 'image' ? (
            <img
              src={replyMediaUrl}
              alt={reply.fileName || toReplyText(reply) || 'Replied image'}
              loading="lazy"
            />
          ) : (
            <>
              {videoThumb ? (
                <img
                  src={videoThumb}
                  alt={reply.fileName || toReplyText(reply) || 'Replied video'}
                  loading="lazy"
                />
              ) : <span className="reply-video-fallback">{icons.video}</span>}
              <span className="reply-video-pill">Video</span>
            </>
          )}
        </span>
        <span className="reply-media-caption">{replyType === 'image' ? 'Photo' : 'Video'}</span>
      </span>
    )
    if (!canJumpToReply) return mediaContent
    return (
      <button
        type="button"
        className="reply-reference-button"
        onPointerDown={blockReplyReferenceGesture}
        onTouchStart={blockReplyReferenceGesture}
        onMouseDown={blockReplyReferenceGesture}
        onClick={(event) => handleReplyReferenceJump(event, reply)}
      >
        {mediaContent}
      </button>
    )
  }

  const renderMessageBody = (message) => {
    const isPlainTextMessage = message.type === 'text' || !message.type || isSecretTapMessageType(message.type)

    if (isPlainTextMessage) {
      return (
        <span className="message-text message-text-with-time">
          <span className="message-text-content">{renderTextWithLinks(message.text)}</span>
          <span className="message-time message-time-inline">{getMessageFooterLabel(message)}</span>
        </span>
      )
    }

    return (
      <>
        {renderMessageMedia(message)}
        {message.fileName && message.type !== 'file' && <div className="message-file-name">{message.fileName}</div>}
        {(message.type && message.type !== 'text' && !message.mediaUrl) && (
          <div className="message-media-fallback">{renderTextWithLinks(`${getTypeIcon(message.type)} ${message.text}`.trim())}</div>
        )}
        <span className="message-time">{getMessageFooterLabel(message)}</span>
      </>
    )
  }

  const handleSelectUserFromPanel = (user) => {
    setSelectedUser(user)
    setUnreadMap((prev) => ({ ...prev, [toUserKey(user.username)]: false }))
    if (isMobileView) {
      setShowMobileUsers(false)
    }
    setReactionTray(null)
  }

  const fallbackViewportHeight = getViewportFallbackHeight()
  const isNativeRuntime = isNativeCapacitorRuntime()
  const isStandaloneDisplayMode = typeof window !== 'undefined' && (
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.navigator?.standalone === true
  )
  const runtimeInnerHeight = typeof window !== 'undefined' ? Math.round(window.innerHeight || 0) : 0
  const runtimeVisualHeight = typeof window !== 'undefined' ? Math.round(window.visualViewport?.height || 0) : 0
  const measuredViewportHeight = (isNativeRuntime && isAndroidPlatform)
    ? Math.max(0, runtimeVisualHeight || Number(viewportHeight || 0) || runtimeInnerHeight || 0)
    : Math.max(
        0,
        Number(viewportHeight || 0),
        runtimeVisualHeight,
        runtimeInnerHeight,
      )
  const useStrictIosWebViewport = !isNativeRuntime && isIosPlatform && isKeyboardOpen
  const resolvedViewportHeight = (isNativeRuntime && isAndroidPlatform)
    ? Math.max(0, measuredViewportHeight || fallbackViewportHeight)
    : useStrictIosWebViewport
      ? Math.max(0, measuredViewportHeight || fallbackViewportHeight)
      : Math.max(0, measuredViewportHeight, fallbackViewportHeight)
  const renderReplyInsideComposer = Boolean(
    isNativeRuntime &&
    isAndroidPlatform &&
    isKeyboardOpen
  )
  const shouldReduceMessageMotion = isTouchDevice || isMobileView || isNativeRuntime || messages.length > 70
  const messageMotionProps = shouldReduceMessageMotion
    ? {}
    : {
        initial: { opacity: 0, y: 20 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -20 },
        whileHover: { scale: 1.02 },
      }
  const getMessageSwipeProps = (message, messageKey) => {
    const isActive = swipingMessage.key === messageKey && swipingMessage.offset > 0
    const directionSign = message?.sender === 'user' ? -1 : 1
    const offset = isActive ? swipingMessage.offset * directionSign : 0
    return {
      isActive,
      bubbleStyle: {
        transform: `translate3d(${offset}px, 0, 0)`,
        transition: isActive ? 'none' : 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
      },
    }
  }
  const getMessageActionsPlacement = (message, messageKey, messageFailed) => {
    if (typeof window === 'undefined' || !messageKey) return 'below'
    return getMessageOverlayMetrics(message, messageKey, messageFailed).actionPlacement
  }
  const renderMessageActions = (message, messageKey, messageFailed) => (
    <div className={`message-actions ${activeMessageActionsKey === messageKey ? 'active' : ''} ${getMessageActionsPlacement(message, messageKey, messageFailed)}`}>
      <div className="message-actions-header">{getMessageFooterLabel(message)}</div>
      <button
        className="btn-copy"
        onClick={() => copyTextToClipboard(message?.text || message?.fileName || '')}
        title="Copy"
        aria-label="Copy"
        disabled={!(message?.text || message?.fileName)}
      >
        <span className="message-action-icon" aria-hidden="true">{icons.copy}</span>
        <span className="message-action-label">Copy</span>
      </button>
      <button
        className="btn-reply"
        onClick={() => handleReply(message)}
        title={messageFailed ? 'Cannot reply to unsent message' : 'Reply'}
        aria-label="Reply"
        disabled={messageFailed}
      >
        <span className="message-action-icon" aria-hidden="true">{icons.reply}</span>
        <span className="message-action-label">Reply</span>
      </button>
      <button className="btn-delete" onClick={() => handleDeleteMessage(message)} title="Delete" aria-label="Delete">
        <DeleteActionIcon />
        <span className="message-action-label">Delete</span>
      </button>
      {message.sender === 'user' && !messageFailed && canEditMessage(message) && (
        <button className="btn-edit" onClick={() => handleStartEdit(message)} title="Edit" aria-label="Edit">
          <span className="message-action-icon" aria-hidden="true">{icons.edit}</span>
          <span className="message-action-label">Edit</span>
        </button>
      )}
      {message.sender === 'user' && messageFailed && (
        <button className="btn-resend" onClick={() => handleResendMessage(message)} title="Resend" aria-label="Resend">
          <span className="message-action-icon" aria-hidden="true">{icons.resend}</span>
          <span className="message-action-label">Resend</span>
        </button>
      )}
    </div>
  )
  const reactionTrayMessage = reactionTray ? getReactionTrayMessage() : null
  const isMessageOverlayOpen = Boolean(isTouchDevice && (reactionTray || activeMessageActionsKey))
  const shouldRenderMessageOverlayBackdrop = isMessageOverlayOpen && !isIosPlatform

  useEffect(() => {
    if (!isTouchDevice) return undefined
    if (!reactionTray && !activeMessageActionsKey) return undefined

    const handleOutsidePress = (event) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('.reaction-tray')) return
      if (target.closest('.message-actions.active')) return
      if (target.closest('.message')) return
      setReactionTray(null)
      setActiveMessageActionsKey(null)
    }

    document.addEventListener('pointerdown', handleOutsidePress, true)
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePress, true)
    }
  }, [isTouchDevice, reactionTray, activeMessageActionsKey])

  return (
    <div
      className={`chat-container ${selectedUser ? 'user-selected' : ''} ${showMobileUsers ? 'mobile-users-open' : ''} ${isKeyboardOpen ? 'keyboard-open' : ''} ${(replyingTo || editingMessage) ? 'has-reply-preview' : ''}`}
      data-ios={isIosPlatform ? 'true' : 'false'}
      data-android={isAndroidPlatform ? 'true' : 'false'}
      data-native={isNativeRuntime ? 'true' : 'false'}
      data-standalone={isStandaloneDisplayMode ? 'true' : 'false'}
      style={{
        '--chat-keyboard-offset': `${Math.max(0, keyboardOffset || 0)}px`,
        '--chat-viewport-height': `${resolvedViewportHeight}px`,
        '--chat-safe-bottom': (isIosPlatform && !isKeyboardOpen) ? 'env(safe-area-inset-bottom)' : '0px',
        '--chat-safe-top': (isIosPlatform || (isNativeRuntime && isAndroidPlatform)) ? 'env(safe-area-inset-top)' : '0px',
        '--chat-vv-top': `${Math.max(0, visualViewportTop)}px`,
        '--chat-vv-bottom': `${Math.max(0, visualViewportBottomGap)}px`,
      }}
    >
      <LoveReminder />
      <LoveJourneyPopupHost />
      <MonthlyRecap token={flow.token} peerUsername={selectedUser?.username} />
      <MilestonePopup token={flow.token} peerUsername={selectedUser?.username} triggerCheck={milestoneTriggerTick} />
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
        reducedMotion={isNativeRuntime || isMobileView || filteredUsers.length > 40}
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
          <button
            type="button"
            className="chat-header-left chat-header-left-btn"
            onClick={openUserInfo}
            title={selectedUser ? 'Open user details' : 'Select a user'}
            aria-label={selectedUser ? 'Open user details' : 'Select a user'}
            disabled={!selectedUser}
          >
            <div className={`chat-user-avatar ${selectedPresence.status === 'online' ? 'online' : 'offline'}`}>
              {selectedUser ? getAvatarLabel(getUserDisplayName(selectedUser)) : '?'}
            </div>
            <div className="chat-user-info">
              <span className="chat-user-name chat-user-name-btn">
                {selectedUser ? getUserDisplayName(selectedUser) : 'Select a user'}
              </span>
              <div className={`chat-user-status ${selectedPresence.status === 'online' ? 'online' : 'offline'}`}>
                {selectedPresence.status === 'online'
                  ? 'Active now'
                  : (selectedPresence.lastSeenAt ? `Active ${toShortLastSeen(selectedPresence.lastSeenAt)}` : 'Active recently')}
              </div>
            </div>
          </button>
          {selectedUser && (
            <div className="chat-header-center-chip">
              <LovePercentageChip
                todayMessages={effectiveTodayMessages}
                yesterdayMessages={headerStats?.yesterdayMessages}
                dailyAverage={headerStats?.dailyAverage}
              />
            </div>
          )}
          <div className="chat-header-actions">
            <button
              className="btn-user-details"
              onClick={() => navigate('/timers')}
              title="Love timers"
              aria-label="Love timers"
            >
              <img src={timerLoveBirdsIcon} alt="" className="timer-icon-image" aria-hidden="true" />
            </button>
                      <SecretTapButton
                        username={flow.username}
                        socketRef={socketRef}
                        onSendSecretTap={handleSecretTapSend}
                      />
          </div>
        </motion.div>

        <motion.div
          className="messages-area"
          ref={messagesAreaRef}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onScroll={handleMessagesScroll}
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
          {(isLoadingOlderMessages || hasOlderMessages) && (
            <div className="messages-pagination-hint">
              {isLoadingOlderMessages ? 'Loading older messages...' : 'Scroll up to load older messages'}
            </div>
          )}
          {shouldReduceMessageMotion ? (
            messages.map((message, index) => {
              const messageKey = getMessageUiKey(message, index)
              const messageFailed = isMessageRetryable(message)
              const swipeProps = getMessageSwipeProps(message, messageKey)
              return (
              <div
                key={messageKey}
                className={`message ${message.sender} ${highlightedMessageKey === messageKey ? 'highlighted' : ''}`}
                ref={(node) => setMessageNodeRef(messageKey, node)}
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
                onClick={(event) => handleMessageTap(event, message, messageKey)}
              >
                <div className="message-bubble-shell">
                  {renderMessageReplyContext(message)}
                  <div
                    className={`message-content ${message.type === 'image' || message.type === 'video' ? 'has-media' : ''}`}
                    style={swipeProps.bubbleStyle}
                  >
                    {message.sender === 'user' && (message.deliveryStatus === 'uploading' || message.deliveryStatus === 'queued') && (
                      <span className="message-upload-ring" title={message.deliveryStatus === 'queued' ? 'Queued' : 'Uploading'} />
                    )}
                    {message.sender === 'user' && message.deliveryStatus === 'failed' && (
                      <span className="message-upload-failed" title="Failed">!</span>
                    )}
                    {renderMessageBody(message)}
                    {message.reaction && (
                      <span className="message-reaction-badge" aria-label={`Reaction ${message.reaction}`}>
                        {message.reaction}
                      </span>
                    )}
                  </div>
                  {shouldShowSeenInline && index === lastOutgoingIndex && activeMessageActionsKey !== messageKey && (
                    <span className="message-seen-inline">👁️ Seen</span>
                  )}
                </div>
                {renderMessageActions(message, messageKey, messageFailed)}
              </div>
            )})
          ) : (
            <AnimatePresence>
              {messages.map((message, index) => {
                const messageKey = getMessageUiKey(message, index)
                const messageFailed = isMessageRetryable(message)
                const swipeProps = getMessageSwipeProps(message, messageKey)
                return (
                <motion.div
                  key={messageKey}
                  className={`message ${message.sender} ${highlightedMessageKey === messageKey ? 'highlighted' : ''}`}
                  ref={(node) => setMessageNodeRef(messageKey, node)}
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
                  onClick={(event) => handleMessageTap(event, message, messageKey)}
                  {...messageMotionProps}
                >
                  <div className="message-bubble-shell">
                    {renderMessageReplyContext(message)}
                    <div
                      className={`message-content ${message.type === 'image' || message.type === 'video' ? 'has-media' : ''}`}
                      style={swipeProps.bubbleStyle}
                    >
                      {message.sender === 'user' && (message.deliveryStatus === 'uploading' || message.deliveryStatus === 'queued') && (
                        <span className="message-upload-ring" title={message.deliveryStatus === 'queued' ? 'Queued' : 'Uploading'} />
                      )}
                      {message.sender === 'user' && message.deliveryStatus === 'failed' && (
                        <span className="message-upload-failed" title="Failed">!</span>
                      )}
                      {renderMessageBody(message)}
                      {message.reaction && (
                        <span className="message-reaction-badge" aria-label={`Reaction ${message.reaction}`}>
                          {message.reaction}
                        </span>
                      )}
                    </div>
                    {shouldShowSeenInline && index === lastOutgoingIndex && activeMessageActionsKey !== messageKey && (
                      <span className="message-seen-inline">👁️ Seen</span>
                    )}
                  </div>
                  {renderMessageActions(message, messageKey, messageFailed)}
                </motion.div>
              )})}
            </AnimatePresence>
          )}
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
          <AnimatePresence>
            {selectedUser && showScrollToLatest && (
              <motion.button
                type="button"
                className="scroll-to-latest-btn"
                initial={{ opacity: 0, y: 18, scale: 0.92 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 18, scale: 0.92 }}
                transition={{ duration: 0.18 }}
                onClick={() => scrollMessagesToBottom('smooth')}
                aria-label="Jump to latest message"
                title="Latest message"
              >
                {'\u2193'}
              </motion.button>
            )}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </motion.div>
        {shouldRenderMessageOverlayBackdrop && (
          <button
            type="button"
            className="reaction-overlay-backdrop"
            aria-label="Dismiss message actions"
            onClick={() => {
              setReactionTray(null)
              setActiveMessageActionsKey(null)
            }}
          />
        )}
        {reactionTray && (
          <div
            className={`reaction-tray ${isTouchDevice ? 'mobile-menu' : ''} ${reactionTrayMessage?.message?.sender === 'user' ? 'sent' : 'received'}`}
            style={getReactionTrayStyle()}
          >
            <div className="reaction-tray-emoji-bar">
              {isTouchDevice && (
                <div className="reaction-tray-helper">Tap and hold to super react</div>
              )}
              <div className="reaction-tray-reactions">
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
                <button
                  type="button"
                  className="reaction-tray-btn reaction-tray-btn-more"
                  onClick={handleCustomReactionPress}
                  aria-label={`React ${PLACEHOLDER_REACTION_EMOJI}`}
                  title={`React ${PLACEHOLDER_REACTION_EMOJI}`}
                >
                  {PLACEHOLDER_REACTION_EMOJI}
                </button>
              </div>
            </div>
          </div>
        )}

        {!renderReplyInsideComposer && (
          <>
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
                  className={`reply-preview ${isCurrentChatUser(replyingTo?.senderName) ? 'reply-target-you' : 'reply-target-other'}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                >
                  <div className="reply-info">
                    <span className="reply-label composer-reply-label">{getComposerReplyLabel(replyingTo)}:</span>
                    <span className="reply-msg">{renderReplyContent(replyingTo, 'composer')}</span>
                  </div>
                  <button className="btn-cancel-reply" onClick={() => setReplyingTo(null)}>X</button>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}

        <motion.div
          className={`input-area ${isDraggingMessage ? 'drop-target' : ''}`}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          initial={{ y: 60 }}
          animate={{ y: 0 }}
          transition={{ duration: 0.3 }}
        >
          {renderReplyInsideComposer && editingMessage && (
            <div className="reply-preview reply-preview-inline edit-preview">
              <div className="reply-info">
                <span className="reply-label">Editing message:</span>
                <span className="reply-msg">{editingMessage.preview}</span>
              </div>
              <button className="btn-cancel-reply" onClick={cancelEditingMessage}>X</button>
            </div>
          )}
          {renderReplyInsideComposer && replyingTo && (
            <div className={`reply-preview reply-preview-inline ${isCurrentChatUser(replyingTo?.senderName) ? 'reply-target-you' : 'reply-target-other'}`}>
              <div className="reply-info">
                <span className="reply-label composer-reply-label">{getComposerReplyLabel(replyingTo)}:</span>
                <span className="reply-msg">{renderReplyContent(replyingTo, 'composer')}</span>
              </div>
              <button className="btn-cancel-reply" onClick={() => setReplyingTo(null)}>X</button>
            </div>
          )}
          <div className="input-wrapper">
            <div className="input-actions">
              <button
                className="btn-action btn-game"
                onClick={(event) => {
                  event.stopPropagation()
                  navigate('/games')
                }}
                title="Open games"
                aria-label="Open games"
              >
                <span className="btn-game-icon" aria-hidden="true">{icons.game}</span>
              </button>
              <SecretTapButton
                username={flow.username}
                socketRef={socketRef}
                onSendSecretTap={handleSecretTapSend}
              />
            </div>
            <div className="message-input-shell">
              <textarea
                ref={messageInputRef}
                className="message-input"
                dir="auto"
                placeholder="Type a message..."
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void handleSendMessage()
                  }
                }}
                onFocus={() => {
                  scrollMessagesToBottom('auto')
                  setTimeout(() => scrollMessagesToBottom('auto'), 120)
                  setTimeout(() => scrollMessagesToBottom('auto'), 320)
                  setTimeout(() => scrollMessagesToBottom('auto'), 520)
                  startKeyboardBottomLock(1600)
                }}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                inputMode="text"
                enterKeyHint="send"
                rows={1}
              />
              {!hasComposerText && (
                <button
                  className={`btn-voice-inline ${isRecordingVoice ? 'recording' : ''}`}
                  onClick={toggleVoiceRecording}
                  title={isRecordingVoice ? `Stop recording (${recordingSeconds}s)` : 'Record voice message'}
                  aria-label={isRecordingVoice ? 'Stop recording' : 'Record voice message'}
                >
                  {isRecordingVoice ? icons.send : <VoiceActionIcon className="voice-action-icon" />}
                </button>
              )}
              {!hasComposerText && (
                <div className="message-input-attachments" ref={attachMenuRef}>
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
                    <div className="attach-dropdown" style={{
                      top: `${attachDropdownPos.top}px`,
                      right: `${attachDropdownPos.right}px`
                    }}>
                      {/* DISABLED: Snap Camera feature
                      <button className="attach-item" onClick={openSnapCamera} title="Open Snap camera" aria-label="Open snap camera">
                        <img src={snapIcon} alt="" className="attach-icon attach-icon-snap" aria-hidden="true" /> Snap
                      </button>
                      */}
                      <button className="attach-item" onClick={() => { mediaInputRef.current?.click(); setShowAttachMenu(false) }} title="Send Photo" aria-label="Send photo">
                        <PhotoAttachIcon className="attach-icon attach-icon-photo" /> Gallary
                      </button>
                      <button className="attach-item" onClick={() => { handleCameraPhotoCapture(); setShowAttachMenu(false) }} title="Capture photo" aria-label="Capture photo" disabled={isCameraLoading}>
                        <CameraAttachIcon className="attach-icon attach-icon-camera" /> Photo
                      </button>
                      <button className="attach-item" onClick={() => { handleCameraVideoCapture(); setShowAttachMenu(false) }} title="Capture video" aria-label="Capture video" disabled={isCameraLoading}>
                        <CameraAttachIcon className="attach-icon attach-icon-camera" /> Camera Video
                      </button>
                      <button className="attach-item" onClick={() => { fileInputRef.current?.click(); setShowAttachMenu(false) }} title="Send File" aria-label="Send file">
                        <FileAttachIcon className="attach-icon attach-icon-file" /> File
                      </button>
                      <button className="attach-item" onClick={() => { window.open('https://www.dropbox.com/scl/fo/8h3g5ew89exduwe6ggfzl/ANS8dEZKaHSSx0cKfTAaphI?rlkey=047i206u35jjwmyahclho66d5&st=w9h1sgsj&dl=0', '_blank'); setShowAttachMenu(false) }} title="Open Dropbox Drive" aria-label="Open Dropbox Drive">
                        <DriveAttachIcon className="attach-icon attach-icon-drive" /> Drive
                      </button>
                    </div>
                  )}
                </div>
              )}
              {isRecordingVoice && (
                <button
                  className="btn-voice-cancel"
                  onClick={cancelVoiceRecording}
                  title="Cancel recording"
                  aria-label="Cancel recording"
                >
                  {icons.cancel}
                </button>
              )}
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
          <input
            type="file"
            ref={cameraPhotoInputRef}
            style={{ display: 'none' }}
            onChange={handleCameraPhotoInputChange}
            accept="image/*"
            capture="environment"
          />
          <input
            type="file"
            ref={cameraVideoInputRef}
            style={{ display: 'none' }}
            onChange={(event) => handleFileUpload(event, 'video')}
            accept="video/*"
            capture="camcorder"
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
            <div className="image-preview-backdrop" onClick={isPendingImageSending ? undefined : clearPendingImagePreview} />
            <motion.div
              className="image-preview-sheet"
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 16, opacity: 0 }}
            >
              <div className="image-preview-title">Preview image</div>
              <img src={pendingImagePreview.url} alt={pendingImagePreview.name} className="image-preview-full" />
              <div className="image-preview-actions">
                <button type="button" className="image-preview-cancel" onClick={clearPendingImagePreview} disabled={isPendingImageSending}>Cancel</button>
                <button type="button" className="image-preview-send" onClick={confirmImagePreviewSend} disabled={isPendingImageSending}>
                  {isPendingImageSending ? 'Sending...' : 'Send'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* DISABLED: Snap Camera feature
      {isSnapCameraOpen && (
        <SnapCameraScreen
          currentUser={flow.username}
          otherUser={selectedUser?.username || ''}
          onClose={() => setIsSnapCameraOpen(false)}
          onSend={(file, capturedType) => sendMediaFile(file, capturedType === 'video' ? 'video' : 'photo')}
        />
      )}
      */}

      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div className="confirm-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div
              className="confirm-modal-backdrop"
              onClick={() => {
                setShowDeleteConfirm(false)
                setPendingDeleteMessage(null)
              }}
            />
            <motion.div className="confirm-modal-card" initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 16, opacity: 0 }}>
              <div className="confirm-modal-title">Delete message?</div>
              <div className="confirm-modal-text">This message will be removed for both users.</div>
              <div className="confirm-modal-actions">
                <button
                  type="button"
                  className="confirm-cancel"
                  onClick={() => {
                    setShowDeleteConfirm(false)
                    setPendingDeleteMessage(null)
                  }}
                >
                  Cancel
                </button>
                <button type="button" className="confirm-danger" onClick={confirmDeleteMessage}>Delete</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <CheckedForYouPopup
        checkerUsername={checkPopup.username}
        checkCount={checkPopup.count}
        onDismiss={handleDismissCheckPopup}
      />
 
</div>
  )
}

export default ChatPageNew




