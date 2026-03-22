import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Client } from '@stomp/stompjs'
import SockJS from 'sockjs-client'
import { toast } from 'react-toastify'
import { useFlowState, resetFlowState } from '../hooks/useFlowState'
import { getConversation } from '../services/messagesApi'
import { getAllUsers } from '../services/usersApi'
import { getNotifyCutoff, pushNotify, setNotifyCutoff } from '../lib/notifications'
import { WS_CHAT_URL } from '../config/apiConfig'
import SecretTapButton from '../components/SecretTapButton'
import './GamesPage.css'

const REALTIME_TOAST_ID = 'realtime-connection'
const CONVERSATION_PAGE_SIZE = 50
const MISSED_SCAN_PAGE_LIMIT = 12
const SECRET_TAP_TYPE = 'secret-tap'

const GAME_ITEMS = [
  { id: 'rps', title: 'Rock / Paper / Scissors', icon: '/theme/icon-rock-paper-scissors.png', path: '/games/rps' },
  { id: 'coin', title: 'Heads / Tails', icon: '/theme/icon-coin.png', path: '/games/coin' },
  { id: 'ttt', title: 'Tic-Tac-Toe', icon: '/theme/icon-tic-tac-toe.png', path: '/games/ttt' },
  { id: 'snake-ladder', title: 'Snake & Ladders', icon: '/theme/icon-snake-ladder.svg', path: '/games/snake-ladder' },
]

const normalizeUsername = (value) => String(value || '').trim().toLowerCase()
const isSecretTapType = (value) => normalizeUsername(value) === SECRET_TAP_TYPE

function GamesPage() {
  const navigate = useNavigate()
  const [flow, setFlow] = useFlowState()
  const wsErrorToastAtRef = useRef(0)
  const wsResumeSuppressUntilRef = useRef(0)
  const wsLastHiddenAtRef = useRef(Date.now())
  const wsErrorTimerRef = useRef(null)
  const socketRef = useRef(null)

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
        .filter((row) => row?.sender === 'other' && !isSecretTapType(row?.type))
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

  const isAndroidLike = () => {
    if (typeof navigator === 'undefined') return false
    return /android/i.test(navigator.userAgent || '')
  }

  const notifyRealtimeIssue = (message) => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
    if (isAndroidLike()) return
    const now = Date.now()
    if (now < Number(wsResumeSuppressUntilRef.current || 0)) return
    if (now - wsErrorToastAtRef.current < 3000) return
    wsErrorToastAtRef.current = now
    toast.clearWaitingQueue()
    toast.error(message, {
      toastId: REALTIME_TOAST_ID,
      autoClose: 1500,
    })
  }

  useEffect(() => {
    if (!flow.username || !flow.token) navigate('/auth')
  }, [flow.username, flow.token, navigate])

  useEffect(() => {
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
      heartbeatIncoming: 10000,
      heartbeatOutgoing: 10000,
      reconnectDelay: 700,
      connectionTimeout: 7000,
      onConnect: () => {
        if (wsErrorTimerRef.current) {
          clearTimeout(wsErrorTimerRef.current)
          wsErrorTimerRef.current = null
        }
        client.subscribe('/user/queue/messages', async (frame) => {
          try {
            const payload = JSON.parse(frame.body)
            const fromUsername = payload?.fromUsername || 'Unknown'
            setNotifyCutoff(authUsername, fromUsername, Number(payload?.createdAt || Date.now()))
          } catch {
            // Ignore invalid realtime payloads.
          }
        })
      },
      onWebSocketError: () => {
        if (Date.now() < Number(wsResumeSuppressUntilRef.current || 0)) return
        if (wsErrorTimerRef.current) return
        wsErrorTimerRef.current = setTimeout(() => {
          wsErrorTimerRef.current = null
          if (client.connected) return
          notifyRealtimeIssue('Realtime connection error on dashboard.')
        }, 1500)
      },
      onWebSocketClose: (event) => {
        const code = event?.code ?? 'n/a'
        if (code === 1000 || code === 1001 || code === 1006) return
        const reason = event?.reason ? `: ${event.reason}` : ''
        notifyRealtimeIssue(`Dashboard realtime disconnected (${code})${reason}`)
      },
      onStompError: (frame) => {
        const reason = frame?.headers?.message || frame?.body || 'STOMP broker error'
        notifyRealtimeIssue(`Dashboard realtime error: ${reason}`)
      },
    })

    socketRef.current = client
    client.activate()
    return () => {
      socketRef.current = null
      if (wsErrorTimerRef.current) {
        clearTimeout(wsErrorTimerRef.current)
        wsErrorTimerRef.current = null
      }
      client.deactivate()
    }
  }, [flow.username, flow.token])

  useEffect(() => () => {
    socketRef.current = null
  }, [])

  useEffect(() => {
    if (!flow.username || !flow.token) return

    let cancelled = false
    let syncing = false

    const notifyMissedWhileOffline = async () => {
      if (syncing) return
      syncing = true
      try {
        const everyone = await getAllUsers(flow.token)
        const peers = (everyone || []).filter(
          (user) => (user?.username || '').toLowerCase() !== (flow.username || '').toLowerCase()
        )

        for (const user of peers) {
          if (cancelled) return
          const peerUsername = user.username
          const cutoff = getNotifyCutoff(flow.username, peerUsername)
          const missed = await getMissedIncomingSince(flow.token, peerUsername, cutoff)
          if (cancelled) return

          if (!missed?.count) continue

          setNotifyCutoff(flow.username, peerUsername, missed.latestIncomingAt || Date.now())
          await pushNotify(`@${peerUsername}`, `${missed.count} new message${missed.count > 1 ? 's' : ''}`)
        }
      } catch (error) {
        if (error?.response?.status === 401) {
          toast.error('Session expired. Please login again.')
          resetFlowState(setFlow)
          navigate('/auth')
          return
        }
        // Ignore missed-notification sync failures on dashboard.
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
  }, [flow.username, flow.token])

  return (
    <section className="games-dashboard-page">
      <header className="games-dashboard-topbar">
        <button className="dash-ctrl-btn" onClick={() => navigate('/profile', { state: { from: '/games' } })}>
          👤 Profile
        </button>
        <button className="dash-ctrl-btn dash-home-btn">Home</button>
        <button className="dash-ctrl-btn" onClick={() => {
          resetFlowState(setFlow);
          navigate('/auth');
        }}>
          🚪 Logout
        </button>
      </header>

      <div className="games-dashboard-layout">
        <section className="games-home-panel">
          <div className="games-home-panel-header">
            <h2>Home</h2>
            <SecretTapButton username={flow.username} socketRef={socketRef} />
          </div>
          <p>Select a Game</p>
          <div className="games-icon-grid">
            {GAME_ITEMS.map((item) => (
              <button key={item.id} className="games-icon-btn" onClick={() => navigate(item.path)}>
                <img src={item.icon} alt={item.title} className="games-icon-img" />
                <span>{item.title}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </section>
  )
}

export default GamesPage
