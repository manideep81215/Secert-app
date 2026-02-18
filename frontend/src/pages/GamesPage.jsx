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
import './GamesPage.css'

const GAME_ITEMS = [
  { id: 'rps', title: 'Rock / Paper / Scissors', icon: '/theme/icon-rock-paper-scissors.png', path: '/games/rps' },
  { id: 'coin', title: 'Heads / Tails', icon: '/theme/icon-coin.png', path: '/games/coin' },
  { id: 'ttt', title: 'Tic-Tac-Toe', icon: '/theme/icon-tic-tac-toe.png', path: '/games/ttt' },
]

function GamesPage() {
  const navigate = useNavigate()
  const [flow, setFlow] = useFlowState()
  const wsErrorToastAtRef = useRef(0)

  const notifyRealtimeIssue = (message) => {
    const now = Date.now()
    if (now - wsErrorToastAtRef.current < 3000) return
    wsErrorToastAtRef.current = now
    toast.error(message)
  }

  useEffect(() => {
    if (!flow.username || !flow.token) navigate('/auth')
  }, [flow.username, flow.token, navigate])

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
      heartbeatIncoming: 20000,
      heartbeatOutgoing: 20000,
      reconnectDelay: 1200,
      onConnect: () => {
        client.subscribe('/user/queue/messages', async (frame) => {
          try {
            const payload = JSON.parse(frame.body)
            const fromUsername = payload?.fromUsername || 'Unknown'
            const type = payload?.type || 'text'
            const text = payload?.message || ''

            const preview = type === 'image'
              ? 'Sent an image'
              : type === 'video'
                ? 'Sent a video'
                : type === 'voice'
                  ? 'Sent a voice message'
                  : type === 'file'
                    ? `Sent file: ${payload?.fileName || 'attachment'}`
                    : text

            await pushNotify(`@${fromUsername}`, preview || 'New message')
            setNotifyCutoff(authUsername, fromUsername, Number(payload?.createdAt || Date.now()))
          } catch {
            // Ignore invalid realtime payloads.
          }
        })
      },
      onWebSocketError: () => {
        notifyRealtimeIssue('Realtime connection error on dashboard.')
      },
      onWebSocketClose: (event) => {
        const code = event?.code ?? 'n/a'
        if (code === 1000 || code === 1001) return
        const reason = event?.reason ? `: ${event.reason}` : ''
        notifyRealtimeIssue(`Dashboard realtime disconnected (${code})${reason}`)
      },
      onStompError: (frame) => {
        const reason = frame?.headers?.message || frame?.body || 'STOMP broker error'
        notifyRealtimeIssue(`Dashboard realtime error: ${reason}`)
      },
    })

    client.activate()
    return () => client.deactivate()
  }, [flow.username, flow.token])

  useEffect(() => {
    if (!flow.username || !flow.token) return

    let cancelled = false

    const notifyMissedWhileOffline = async () => {
      try {
        const everyone = await getAllUsers(flow.token)
        const peers = (everyone || []).filter(
          (user) => (user?.username || '').toLowerCase() !== (flow.username || '').toLowerCase()
        )

        for (const user of peers) {
          if (cancelled) return
          const peerUsername = user.username
          const cutoff = getNotifyCutoff(flow.username, peerUsername)
          const rows = await getConversation(flow.token, peerUsername)
          if (cancelled) return

          const missed = (rows || [])
            .filter((row) => row?.sender === 'other')
            .filter((row) => Number(row?.createdAt || 0) > cutoff)

          if (!missed.length) continue

          const latest = Math.max(...missed.map((row) => Number(row.createdAt || 0)))
          setNotifyCutoff(flow.username, peerUsername, latest || Date.now())
          await pushNotify(`@${peerUsername}`, `${missed.length} new message${missed.length > 1 ? 's' : ''}`)
        }
      } catch (error) {
        if (error?.response?.status === 401) {
          toast.error('Session expired. Please login again.')
          resetFlowState(setFlow)
          navigate('/auth')
          return
        }
        // Ignore missed-notification sync failures on dashboard.
      }
    }

    notifyMissedWhileOffline()
    return () => {
      cancelled = true
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
          <h2>Home</h2>
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
