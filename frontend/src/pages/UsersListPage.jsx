import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Client } from '@stomp/stompjs'
import SockJS from 'sockjs-client'
import { toast } from 'react-toastify'
import { useFlowState } from '../hooks/useFlowState'
import { getAllUsers } from '../services/usersApi'
import { getConversation } from '../services/messagesApi'
import { WS_CHAT_URL } from '../config/apiConfig'
import { getNotifyCutoff, setNotifyCutoff } from '../lib/notifications'
import './UsersListPage.css'

function UsersListPage() {
  const navigate = useNavigate()
  const [flow] = useFlowState()
  const [users, setUsers] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [statusMap, setStatusMap] = useState({})
  const [unreadMap, setUnreadMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [reloadTick, setReloadTick] = useState(0)
  const usersRef = useRef([])
  const tokenRef = useRef(flow.token || '')
  const usernameRef = useRef(flow.username || '')

  useEffect(() => {
    if (!flow.token || !flow.username) {
      navigate('/auth')
      return
    }
    if (!flow.verified) {
      navigate('/verify')
      return
    }

    const loadUsers = async () => {
      const messagePreview = (row) => {
        const type = row?.type || 'text'
        if (type === 'image') return 'Sent an image'
        if (type === 'video') return 'Sent a video'
        if (type === 'voice') return 'Sent a voice message'
        if (type === 'file') return row?.fileName ? `Sent file: ${row.fileName}` : 'Sent a file'
        return row?.text || row?.message || 'No messages yet'
      }
      try {
        const dbUsers = await getAllUsers(flow.token)
        const me = (flow.username || '').toLowerCase()
        const baseUsers = (dbUsers || [])
          .filter((user) => (user?.username || '').toLowerCase() !== me)
          .map((user) => ({
            id: user.id,
            username: user.username,
            status: 'offline',
            lastMessage: 'No messages yet',
            lastMessageTime: '-',
          }))

        const unreadNext = {}
        const enrichedUsers = await Promise.all(baseUsers.map(async (user) => {
          try {
            const rows = await getConversation(flow.token, user.username)
            const list = Array.isArray(rows) ? rows : []
            const last = list[list.length - 1]
            const incoming = list.filter((row) => row?.sender === 'other')
            const cutoff = getNotifyCutoff(flow.username, user.username)
            const unreadCount = incoming.filter((row) => Number(row?.createdAt || 0) > cutoff).length
            if (unreadCount > 0) {
              unreadNext[(user.username || '').toLowerCase()] = unreadCount
            }

            return {
              ...user,
              lastMessage: last ? messagePreview(last) : 'No messages yet',
              lastMessageTime: last?.createdAt
                ? new Date(last.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : '-',
            }
          } catch {
            return user
          }
        }))

        setUnreadMap(unreadNext)
        setUsers(enrichedUsers)
        usersRef.current = enrichedUsers
      } catch (error) {
        console.error('Failed to load users', error)
        toast.error('Failed to load users')
      } finally {
        setLoading(false)
      }
    }

    loadUsers()
  }, [flow.token, flow.username, flow.verified, navigate, reloadTick])

  useEffect(() => {
    if (!flow.token || !flow.username) return
    const triggerRefresh = () => {
      setReloadTick(Date.now())
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
    usersRef.current = users
  }, [users])

  useEffect(() => {
    tokenRef.current = flow.token || ''
    usernameRef.current = flow.username || ''
  }, [flow.token, flow.username])

  useEffect(() => {
    const authToken = (flow.token || '').trim()
    const authUsername = (flow.username || '').trim()
    if (!authToken || !authUsername) return

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
        client.subscribe('/user/queue/messages', (frame) => {
          try {
            const payload = JSON.parse(frame.body)
            const fromUsernameRaw = (payload?.fromUsername || '').trim()
            const fromUsername = toUserKey(fromUsernameRaw)
            if (!fromUsername) return

            setUnreadMap((prev) => ({ ...prev, [fromUsername]: (prev[fromUsername] || 0) + 1 }))

            const preview = previewFromPayload(payload)
            const messageTime = new Date(Number(payload?.createdAt || Date.now()))
              .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

            setUsers((prev) => prev.map((user) => (
              (user.username || '').toLowerCase() === fromUsername
                ? { ...user, lastMessage: preview, lastMessageTime: messageTime }
                : user
            )))

            setNotifyCutoff(flow.username, fromUsernameRaw, Number(payload?.createdAt || Date.now()))
          } catch {
            // Ignore malformed realtime payload.
          }
        })

        client.subscribe('/topic/user-status', (frame) => {
          try {
            const payload = JSON.parse(frame.body)
            const username = (payload?.username || '').trim()
            const status = payload?.status
            if (!username || !status) return
            setStatusMap((prev) => ({ ...prev, [username.toLowerCase()]: status }))
          } catch {
            // Ignore malformed status payload.
          }
        })
      },
    })

    client.activate()
    return () => client.deactivate()
  }, [flow.token, flow.username])

  const formatUsername = (username) => {
    return username ? username.charAt(0).toUpperCase() + username.slice(1).toLowerCase() : ''
  }

  const getAvatarLabel = (username) => {
    return username ? username.substring(0, 2).toUpperCase() : '?'
  }

  const filteredUsers = useMemo(() => users.filter((user) =>
    user.username.toLowerCase().includes(searchQuery.toLowerCase())
  ), [users, searchQuery])

  return (
    <div className="users-list-page">
      <div className="users-header">
        <h1>Messages</h1>
        <button className="btn-new-chat" onClick={() => navigate('/chat')}>
          +
        </button>
      </div>

      <div className="users-search-container">
        <input
          type="text"
          placeholder="Search users..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="users-search-input"
        />
      </div>

      <div className="users-list-container">
        {loading ? (
          <div className="loading">Loading users...</div>
        ) : filteredUsers.length === 0 ? (
          <div className="no-users">
            {users.length === 0 ? 'No users available' : 'No users found'}
          </div>
        ) : (
          <AnimatePresence>
            {filteredUsers.map((user) => (
              (() => {
                const unreadCount = unreadMap[(user.username || '').toLowerCase()] || 0
                const hasUnread = unreadCount > 0
                return (
              <motion.div
                key={user.id}
                className={`user-card ${hasUnread ? 'unread' : ''}`}
                onClick={() => {
                  const key = (user.username || '').toLowerCase()
                  setUnreadMap((prev) => {
                    if (!prev[key]) return prev
                    const next = { ...prev }
                    delete next[key]
                    return next
                  })
                  setNotifyCutoff(flow.username, user.username, Date.now())
                  navigate('/chat', { state: { selectedUserId: user.id, selectedUsername: user.username } })
                }}
                whileHover={{ backgroundColor: 'rgba(0,0,0,0.02)' }}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <div className="user-avatar">{getAvatarLabel(user.username)}</div>
                <div className="user-card-info">
                  <div className="user-card-name">@{formatUsername(user.username)}</div>
                  <div className="user-card-last-msg">
                    {hasUnread
                      ? (
                        <span className="user-card-unread-text">
                          {unreadCount >= 5
                            ? '4+ new messages'
                            : `${unreadCount} new message${unreadCount > 1 ? 's' : ''}`}
                        </span>
                      )
                      : user.lastMessage}
                  </div>
                </div>
                <div className={`user-card-status ${(statusMap[(user.username || '').toLowerCase()] || user.status)}`} />
                {hasUnread && (
                  <span className="user-card-unread-dot" aria-label={`${unreadCount} unread`} />
                )}
                <div className="user-card-time">{user.lastMessageTime}</div>
              </motion.div>
                )
              })()
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  )
}

export default UsersListPage
