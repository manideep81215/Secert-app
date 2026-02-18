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
import { API_BASE_URL, WS_CHAT_URL } from '../config/apiConfig'
import { resetFlowState, useFlowState } from '../hooks/useFlowState'
import './ChatPageNew.css'

function ChatPageNew() {
  const navigate = useNavigate()
  const location = useLocation()
  const [flow, setFlow] = useFlowState()
  const [users, setUsers] = useState([])
  const [statusMap, setStatusMap] = useState({})
  const [typingMap, setTypingMap] = useState({})
  const [selectedUser, setSelectedUser] = useState(null)
  const [conversationClears, setConversationClears] = useState({})
  const [messages, setMessages] = useState([])
  const [inputValue, setInputValue] = useState('')
  const [presenceTick, setPresenceTick] = useState(Date.now())
  const [searchQuery, setSearchQuery] = useState('')
  const [showUserDetails, setShowUserDetails] = useState(false)
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const [isMobileView, setIsMobileView] = useState(() => window.innerWidth <= 920)
  const [showMobileUsers, setShowMobileUsers] = useState(() => window.innerWidth <= 920)
  const [replyingTo, setReplyingTo] = useState(null)
  const [draggedMessage, setDraggedMessage] = useState(null)
  const [isDraggingMessage, setIsDraggingMessage] = useState(false)
  const [swipePreview, setSwipePreview] = useState({ key: null, offset: 0 })
  const [socket, setSocket] = useState(null)
  const [isRecordingVoice, setIsRecordingVoice] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [notificationPermission, setNotificationPermission] = useState(
    getNotificationPermissionState()
  )
  const mediaInputRef = useRef(null)
  const fileInputRef = useRef(null)
  const messagesEndRef = useRef(null)
  const selectedUserRef = useRef(null)
  const attachMenuRef = useRef(null)
  const typingTimeoutRef = useRef(null)
  const typingStateRef = useRef(false)
  const sendAckTimeoutsRef = useRef({})
  const swipeReplyRef = useRef({ active: false, pointerId: null, startX: 0, startY: 0, message: null, key: null })
  const mediaRecorderRef = useRef(null)
  const recordingStreamRef = useRef(null)
  const recordingChunksRef = useRef([])
  const recordingTimerRef = useRef(null)
  const wsErrorToastAtRef = useRef(0)
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
    delete: '\u2715',
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
    const current = statusMap[username]
    if (current) {
      return current
    }
    return { status: fallback, lastSeenAt: null }
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
    if (!offlineSinceRef.current[username]) {
      offlineSinceRef.current[username] = Date.now()
    }
    return { ...presence, lastSeenAt: offlineSinceRef.current[username] }
  }
  const selectedPresence = selectedUser ? getResolvedPresence(selectedUser.username, selectedUser.status) : { status: 'offline', lastSeenAt: null }
  const selectedTyping = selectedUser ? Boolean(typingMap[selectedUser.username]) : false

  useEffect(() => {
    selectedUserRef.current = selectedUser
  }, [selectedUser])

  useEffect(() => {
    const onResize = () => {
      const mobile = window.innerWidth <= 920
      setIsMobileView(mobile)
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
    getMe(flow.token).catch(() => {
      toast.error('Session expired, login again.')
      resetFlowState(setFlow)
      navigate('/auth')
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
          createdAt: row.createdAt || null,
          timestamp: formatTimestamp(row.createdAt),
        }))
        setMessages(normalized)
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
      heartbeatIncoming: 20000,
      heartbeatOutgoing: 20000,
      reconnectDelay: 1000,
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
              timestamp: getTimeLabel(),
              senderName: formatUsername(fromUsername),
              messageId: data?.id,
            }
            incoming.timestamp = formatTimestamp(incoming.createdAt)
            const incomingPreview = getMessagePreview(incoming.type, incoming.text, incoming.fileName)
            await pushNotify(`@${formatUsername(fromUsername)}`, incomingPreview)
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
                      createdAt: ack?.createdAt || msg.createdAt || null,
                      timestamp: formatTimestamp(ack?.createdAt || msg.createdAt),
                    }
                  : msg
              ))
            )
          } catch (error) {
            console.error('Failed parsing send ack payload', error)
          }
        })
      },
      onWebSocketError: () => {
        notifyRealtimeIssue('Realtime connection error (websocket).')
      },
      onWebSocketClose: (event) => {
        const code = event?.code ?? 'n/a'
        if (code === 1000 || code === 1001) return
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

    const notifyMissedWhileOffline = async () => {
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
          await pushNotify(`@${formatUsername(user.username)}`, `${missed.length} new message${missed.length > 1 ? 's' : ''}`)
        } catch {
          // Ignore missed-notification sync failures per conversation.
        }
      }
    }

    notifyMissedWhileOffline()
    return () => {
      cancelled = true
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
    const now = Date.now()
    if (now - wsErrorToastAtRef.current < 3000) return
    wsErrorToastAtRef.current = now
    toast.error(message)
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

    publishTyping(false, true)
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }

    const tempId = createTempId()
    const outgoing = {
      sender: 'user',
      text,
      timestamp: getTimeLabel(),
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
    await sendMediaFile(file, type)
    if (event?.target) {
      event.target.value = ''
    }
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

  const deleteMessage = (targetMessage) => {
    setMessages((prev) => prev.filter((msg) => msg !== targetMessage))
  }

  const handleDeleteChatForMe = () => {
    if (!selectedUser) return
    const ok = window.confirm(`Delete chat with @${formatUsername(selectedUser.username)} for you only?`)
    if (!ok) return

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
  }

  const handleReply = (message) => {
    setReplyingTo(message)
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

  const clearSwipePreview = () => {
    setSwipePreview({ key: null, offset: 0 })
  }

  const handleMessagePointerDown = (event, message, messageKey) => {
    if (event.pointerType !== 'touch') return
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (!target.closest('.message-content')) return
    if (target.closest('button, a, audio, video, input, textarea')) return
    const edgeSafeZone = 18
    if (event.clientX <= edgeSafeZone || event.clientX >= window.innerWidth - edgeSafeZone) return
    swipeReplyRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      message,
      key: messageKey,
    }
    setSwipePreview({ key: messageKey, offset: 0 })
  }

  const handleMessagePointerMove = (event) => {
    const state = swipeReplyRef.current
    if (!state.active || state.pointerId !== event.pointerId) return
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    if (Math.abs(dy) > 24) {
      swipeReplyRef.current = { active: false, pointerId: null, startX: 0, startY: 0, message: null, key: null }
      clearSwipePreview()
      return
    }

    const rightSwipe = Math.max(0, Math.min(dx, 90))
    setSwipePreview({ key: state.key, offset: rightSwipe })

    if (dx > 72 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      event.preventDefault()
      setReplyingTo(state.message)
      swipeReplyRef.current = { active: false, pointerId: null, startX: 0, startY: 0, message: null, key: null }
      clearSwipePreview()
    }
  }

  const handleMessagePointerEnd = () => {
    swipeReplyRef.current = { active: false, pointerId: null, startX: 0, startY: 0, message: null, key: null }
    clearSwipePreview()
  }

  const renderMessageMedia = (message) => {
    if (!message?.type || !message.mediaUrl) return null

    if (message.type === 'image') {
      return <img className="message-image-preview" src={message.mediaUrl} alt={message.fileName || 'image'} />
    }
    if (message.type === 'video') {
      return <video className="message-video-preview" src={message.mediaUrl} controls preload="metadata" />
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
    <div className={`chat-container ${showUserDetails ? 'details-open' : ''} ${selectedUser ? 'user-selected' : ''} ${showMobileUsers ? 'mobile-users-open' : ''}`}>
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
                <div className="user-avatar">{getAvatarLabel(user.username)}</div>
                <div className="user-info">
                  <div className="user-name">@{formatUsername(user.username)}</div>
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
          <div className="chat-header-left">
            <div className="chat-user-avatar">{selectedUser ? getAvatarLabel(selectedUser.username) : '?'}</div>
            <div className="chat-user-info">
              <div className="chat-user-name">{selectedUser ? `@${formatUsername(selectedUser.username)}` : 'Select a user'}</div>
              <div className={`chat-user-status ${selectedPresence.status === 'online' ? 'online' : 'offline'}`}>
                {selectedTyping ? 'typing...' : (selectedPresence.status === 'online' ? 'online' : toLongLastSeen(selectedPresence.lastSeenAt))}
              </div>
            </div>
          </div>
          <div className="chat-header-actions">
            <button
              className="btn-delete-chat"
              onClick={handleDeleteChatForMe}
              title="Delete chat for me"
              aria-label="Delete chat for me"
              disabled={!selectedUser}
            >
              {icons.delete}
            </button>
            <button
              className={`btn-user-details ${notificationPermission === 'granted' ? 'notify-enabled' : ''}`}
              onClick={requestNotificationAccess}
              title={notificationPermission === 'granted' ? 'Notifications enabled' : 'Enable notifications'}
              aria-label="Enable notifications"
            >
              N
            </button>
            <button
              className="btn-home-game"
              onClick={() => navigate('/games')}
              title="Go to dashboard"
              aria-label="Go to dashboard"
            >
              {icons.game}
            </button>
            <button
              className="btn-user-details"
              onClick={() => setShowUserDetails((prev) => !prev)}
              title="User info"
              aria-label="User info"
            >
              i
            </button>
          </div>
        </motion.div>

        <motion.div
          className="messages-area"
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          <AnimatePresence>
            {messages.map((message, index) => {
              const messageKey = `${index}-${message.createdAt || message.timestamp}-${message.text}`
              return (
              <motion.div
                key={messageKey}
                className={`message ${message.sender}`}
                draggable={true}
                onDragStart={(event) => handleDragStart(event, message)}
                onDragEnd={handleDragEnd}
                onPointerDown={(event) => handleMessagePointerDown(event, message, messageKey)}
                onPointerMove={handleMessagePointerMove}
                onPointerUp={handleMessagePointerEnd}
                onPointerCancel={handleMessagePointerEnd}
                style={{
                  transform: swipePreview.key === messageKey ? `translateX(${swipePreview.offset}px)` : undefined,
                  transition: swipePreview.key === messageKey ? 'none' : 'transform 0.14s ease',
                }}
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
                  <span className="message-time">{message.timestamp}</span>
                </div>
                <div className="message-actions">
                  <button className="btn-reply" onClick={() => handleReply(message)} title="Reply" aria-label="Reply">{icons.reply}</button>
                  {message.sender === 'user' && (
                    <button className="btn-delete" onClick={() => deleteMessage(message)} title="Delete" aria-label="Delete">{icons.delete}</button>
                  )}
                </div>
              </motion.div>
            )})}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </motion.div>

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
              <div className="details-avatar">{selectedUser ? getAvatarLabel(selectedUser.username) : '?'}</div>
              <h2 className="details-name">{selectedUser ? `@${formatUsername(selectedUser.username)}` : '-'}</h2>
              <p className="details-status">
                {selectedTyping ? 'typing...' : (selectedPresence.status === 'online' ? 'online' : toLongLastSeen(selectedPresence.lastSeenAt))}
              </p>

              <div className="details-section">
                <h4>Contact Information</h4>
                <div className="detail-item">
                  <span className="detail-label">Username:</span>
                  <span className="detail-value">{selectedUser ? selectedUser.username : '-'}</span>
                </div>
              </div>

              <div className="details-section">
                <h4>About</h4>
                <p className="details-bio">Realtime chat user loaded from database.</p>
              </div>

              <div className="details-section">
                <h4>Media</h4>
                <div className="media-grid">
                  {messages
                    .filter((msg) => msg.type && (msg.type === 'image' || msg.type === 'video') && msg.mediaUrl)
                    .map((msg, idx) => (
                      <a
                        key={idx}
                        className="media-item"
                        href={msg.mediaUrl}
                        target="_blank"
                        rel="noreferrer"
                        title={msg.fileName || (msg.type === 'image' ? 'Image' : 'Video')}
                      >
                        {msg.type === 'image' ? '🖼️' : '🎬'}
                      </a>
                    ))}
                </div>
                {messages.filter((msg) => msg.type && (msg.type === 'image' || msg.type === 'video') && msg.mediaUrl).length === 0 && (
                  <p className="details-bio">No media shared yet.</p>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default ChatPageNew
