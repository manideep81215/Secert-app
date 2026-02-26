import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Client } from '@stomp/stompjs'
import SockJS from 'sockjs-client'
import { useFlowState } from '../hooks/useFlowState'
import BackIcon from '../components/BackIcon'
import { WS_CHAT_URL } from '../config/apiConfig'
import './SnakeLadderGamePage.css'

const DIFFICULTY_PRESETS = {
  easy: {
    label: 'Easy',
    ladders: [
      [3, 21],
      [8, 30],
      [28, 55],
      [36, 63],
      [51, 72],
      [71, 92],
    ],
    snakes: [
      [25, 5],
      [49, 29],
      [67, 47],
      [88, 66],
      [96, 76],
    ],
  },
  medium: {
    label: 'Medium',
    ladders: [
      [4, 14],
      [9, 31],
      [21, 42],
      [28, 50],
      [40, 61],
      [63, 84],
    ],
    snakes: [
      [19, 7],
      [35, 16],
      [48, 27],
      [66, 45],
      [79, 58],
      [93, 73],
      [98, 79],
    ],
  },
  hard: {
    label: 'Hard',
    ladders: [
      [2, 12],
      [11, 26],
      [22, 40],
      [45, 64],
      [70, 88],
    ],
    snakes: [
      [17, 4],
      [31, 10],
      [43, 21],
      [57, 36],
      [69, 49],
      [78, 54],
      [87, 60],
      [95, 72],
      [99, 80],
    ],
  },
}

const BOARD_ROWS = Array.from({ length: 10 }, (_, rowFromTop) => {
  const rowFromBottom = 9 - rowFromTop
  const start = rowFromBottom * 10 + 1
  const values = Array.from({ length: 10 }, (_, col) => start + col)
  return rowFromBottom % 2 === 0 ? values : [...values].reverse()
})

const DIFFICULTY_KEYS = ['easy', 'medium', 'hard']
const MODE_OPTIONS = [
  { value: 'cpu', label: 'Vs CPU' },
  { value: 'friend', label: 'Play with Friend' },
  { value: 'online', label: 'Online Multiplayer' },
]

function randomDice() {
  return Math.floor(Math.random() * 6) + 1
}

function normalizeUsername(value) {
  return (value || '').trim().toLowerCase()
}

function toCellPoint(cell) {
  const index = cell - 1
  const rowFromBottom = Math.floor(index / 10)
  const inRow = index % 10
  const col = rowFromBottom % 2 === 0 ? inRow : 9 - inRow
  const x = (col + 0.5) * 10
  const y = (9 - rowFromBottom + 0.5) * 10
  return { x, y }
}

function SnakeLadderGamePage() {
  const navigate = useNavigate()
  const [flow, setFlow] = useFlowState()
  const [difficulty, setDifficulty] = useState('medium')
  const [mode, setMode] = useState('cpu')
  const [friendName, setFriendName] = useState('Friend')
  const [positions, setPositions] = useState({ you: 1, opponent: 1 })
  const [turn, setTurn] = useState('you')
  const [diceValue, setDiceValue] = useState(null)
  const [status, setStatus] = useState('Pick difficulty and roll the dice.')
  const [winner, setWinner] = useState('')
  const [isRolling, setIsRolling] = useState(false)
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false)
  const [isDifficultyMenuOpen, setIsDifficultyMenuOpen] = useState(false)
  const [onlineRoomInput, setOnlineRoomInput] = useState('')
  const [onlineRoomId, setOnlineRoomId] = useState('')
  const [onlineRole, setOnlineRole] = useState('')
  const [onlineHostUsername, setOnlineHostUsername] = useState('')
  const [onlineGuestUsername, setOnlineGuestUsername] = useState('')
  const [isOnlineConnected, setIsOnlineConnected] = useState(false)
  const opponentTimerRef = useRef(null)
  const positionsRef = useRef({ you: 1, opponent: 1 })
  const waitTimersRef = useRef(new Set())
  const animationVersionRef = useRef(0)
  const modeMenuRef = useRef(null)
  const difficultyMenuRef = useRef(null)
  const onlineClientRef = useRef(null)
  const onlineQueueSubRef = useRef(null)
  const onlineRoomSubRef = useRef(null)
  const onlineRoomIdRef = useRef('')

  useEffect(() => {
    if (!flow.username || !flow.token) navigate('/auth')
  }, [flow.username, flow.token, navigate])

  useEffect(() => () => {
    animationVersionRef.current += 1
    if (opponentTimerRef.current) {
      clearTimeout(opponentTimerRef.current)
      opponentTimerRef.current = null
    }
    waitTimersRef.current.forEach((timerId) => clearTimeout(timerId))
    waitTimersRef.current.clear()
  }, [])

  useEffect(() => {
    positionsRef.current = positions
  }, [positions])

  useEffect(() => {
    const handleOutsidePress = (event) => {
      if (!modeMenuRef.current?.contains(event.target)) {
        setIsModeMenuOpen(false)
      }
      if (!difficultyMenuRef.current?.contains(event.target)) {
        setIsDifficultyMenuOpen(false)
      }
    }
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setIsModeMenuOpen(false)
        setIsDifficultyMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsidePress)
    document.addEventListener('touchstart', handleOutsidePress, { passive: true })
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleOutsidePress)
      document.removeEventListener('touchstart', handleOutsidePress)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [])

  const preset = DIFFICULTY_PRESETS[difficulty]
  const jumpMap = useMemo(() => {
    const map = {}
    for (const [from, to] of preset.ladders) map[from] = to
    for (const [from, to] of preset.snakes) map[from] = to
    return map
  }, [preset])

  const activeFriendName = friendName.trim() || 'Friend'
  const selectedModeLabel = MODE_OPTIONS.find((item) => item.value === mode)?.label || 'Vs CPU'

  const getOnlineOpponentName = () => {
    const me = normalizeUsername(flow.username)
    const host = normalizeUsername(onlineHostUsername)
    const guest = normalizeUsername(onlineGuestUsername)
    if (!host && !guest) return 'Opponent'
    if (me === host) return guest || 'Opponent'
    if (me === guest) return host || 'Opponent'
    return onlineGuestUsername || onlineHostUsername || 'Opponent'
  }

  const getPlayerLabel = (playerKey) => {
    if (playerKey === 'you') return flow.username || 'You'
    if (mode === 'cpu') return 'Computer'
    if (mode === 'online') return getOnlineOpponentName()
    return activeFriendName
  }

  const resetGame = (nextDifficulty = difficulty, nextMode = mode) => {
    animationVersionRef.current += 1
    if (opponentTimerRef.current) {
      clearTimeout(opponentTimerRef.current)
      opponentTimerRef.current = null
    }
    waitTimersRef.current.forEach((timerId) => clearTimeout(timerId))
    waitTimersRef.current.clear()
    setDifficulty(nextDifficulty)
    setMode(nextMode)
    setPositions({ you: 1, opponent: 1 })
    positionsRef.current = { you: 1, opponent: 1 }
    setTurn('you')
    setDiceValue(null)
    setWinner('')
    setIsRolling(false)
    setIsModeMenuOpen(false)
    setIsDifficultyMenuOpen(false)
    if (nextMode === 'online') {
      setStatus('Online mode ready. Create or join a room.')
      return
    }
    setStatus(`Difficulty: ${DIFFICULTY_PRESETS[nextDifficulty].label}. ${flow.username || 'You'} turn, roll the dice.`)
  }

  const unlock = () => {
    if (flow.unlocked) return
    setFlow((prev) => ({ ...prev, unlocked: true }))
  }

  const waitFor = (ms) => new Promise((resolve) => {
    const timerId = setTimeout(() => {
      waitTimersRef.current.delete(timerId)
      resolve()
    }, ms)
    waitTimersRef.current.add(timerId)
  })

  const animateMoveTo = async (playerKey, targetCell, stepDelay = 170) => {
    let current = Number(positionsRef.current[playerKey] || 1)
    if (targetCell === current) return current
    const direction = targetCell > current ? 1 : -1

    while (current !== targetCell) {
      current += direction
      setPositions((prev) => {
        const next = { ...prev, [playerKey]: current }
        positionsRef.current = next
        return next
      })
      await waitFor(stepDelay)
    }

    return current
  }

  const runTurn = async (playerKey) => {
    if (winner) return
    const animationVersion = animationVersionRef.current
    const actor = getPlayerLabel(playerKey)
    setIsRolling(true)
    const roll = randomDice()
    setDiceValue(roll)
    await waitFor(420)
    if (animationVersion !== animationVersionRef.current) return

    const current = Number(positionsRef.current[playerKey] || 1)
    const moved = current + roll
    const landing = moved > 100 ? current : moved

    if (moved > 100) {
      setStatus(`${actor} rolled ${roll}. Need exact number for 100.`)
    } else {
      setStatus(`${actor} rolled ${roll}. Moving...`)
      await animateMoveTo(playerKey, landing, 380)
      if (animationVersion !== animationVersionRef.current) return
    }

    let finalCell = landing
    if (jumpMap[landing]) {
      const target = jumpMap[landing]
      const isLadder = target > landing
      setStatus(`${actor}: ${isLadder ? 'Ladder up' : 'Snake bite'} ${landing} to ${target}.`)
      await waitFor(250)
      if (animationVersion !== animationVersionRef.current) return
      await animateMoveTo(playerKey, target, 340)
      if (animationVersion !== animationVersionRef.current) return
      finalCell = target
    } else if (moved <= 100) {
      setStatus(`${actor} moved to ${landing}.`)
    }

    setIsRolling(false)
    if (finalCell === 100) {
      setWinner(playerKey)
      setStatus(`${actor} won the game.`)
      if (playerKey === 'you') unlock()
      return
    }
    setTurn(playerKey === 'you' ? 'opponent' : 'you')
  }

  const publishOnline = (destination, body) => {
    const client = onlineClientRef.current
    if (!client || !client.connected) return false
    client.publish({ destination, body: JSON.stringify(body) })
    return true
  }

  const applyOnlineState = (event) => {
    const host = normalizeUsername(event?.hostUsername)
    const guest = normalizeUsername(event?.guestUsername)
    const me = normalizeUsername(flow.username)

    setOnlineHostUsername(host)
    setOnlineGuestUsername(guest)

    const inferredRole = me && me === host ? 'host' : me && me === guest ? 'guest' : onlineRole
    if (inferredRole) setOnlineRole(inferredRole)

    const hostPos = Number(event?.hostPosition || 1)
    const guestPos = Number(event?.guestPosition || 1)
    if (inferredRole === 'guest') {
      setPositions({ you: guestPos, opponent: hostPos })
      positionsRef.current = { you: guestPos, opponent: hostPos }
    } else {
      setPositions({ you: hostPos, opponent: guestPos })
      positionsRef.current = { you: hostPos, opponent: guestPos }
    }

    setDiceValue(Number.isInteger(event?.lastRoll) ? event.lastRoll : null)

    const winnerName = normalizeUsername(event?.winnerUsername)
    if (!winnerName) {
      setWinner('')
    } else {
      const iWon = winnerName === me
      setWinner(iWon ? 'you' : 'opponent')
      if (iWon) unlock()
    }

    const turnName = normalizeUsername(event?.turnUsername)
    if (!turnName) {
      setTurn('you')
    } else {
      setTurn(turnName === me ? 'you' : 'opponent')
    }

    if (event?.message) {
      setStatus(event.message)
    }
  }

  const subscribeOnlineRoom = (roomId) => {
    const client = onlineClientRef.current
    if (!client || !client.connected || !roomId) return

    onlineRoomSubRef.current?.unsubscribe?.()
    onlineRoomSubRef.current = client.subscribe(`/topic/snl.room.${roomId}`, (frame) => {
      try {
        const event = JSON.parse(frame.body || '{}')
        applyOnlineState(event)
      } catch {
        setStatus('Online: invalid room update.')
      }
    })
  }

  const teardownOnline = (sendLeave = true) => {
    try {
      if (sendLeave && onlineRoomIdRef.current) {
        publishOnline('/app/snl.leave', { roomId: onlineRoomIdRef.current })
      }
    } catch {
      // Ignore leave errors.
    }

    onlineRoomSubRef.current?.unsubscribe?.()
    onlineRoomSubRef.current = null
    onlineQueueSubRef.current?.unsubscribe?.()
    onlineQueueSubRef.current = null

    const client = onlineClientRef.current
    if (client) {
      client.deactivate()
      onlineClientRef.current = null
    }

    onlineRoomIdRef.current = ''
    setOnlineRoomId('')
    setOnlineRole('')
    setOnlineHostUsername('')
    setOnlineGuestUsername('')
    setOnlineRoomInput('')
    setIsOnlineConnected(false)
  }

  useEffect(() => {
    if (mode !== 'online') {
      teardownOnline(true)
      return undefined
    }

    const authToken = (flow.token || '').trim()
    const authUsername = (flow.username || '').trim()
    if (!authToken || !authUsername) return undefined
    if (onlineClientRef.current?.connected) return undefined

    const client = new Client({
      webSocketFactory: () => new SockJS(WS_CHAT_URL, null, {
        transports: ['websocket', 'xhr-streaming', 'xhr-polling'],
      }),
      connectHeaders: {
        username: authUsername,
        Authorization: `Bearer ${authToken}`,
      },
      reconnectDelay: 1200,
      heartbeatIncoming: 10000,
      heartbeatOutgoing: 10000,
      onConnect: () => {
        setIsOnlineConnected(true)
        setStatus('Online connected. Create or join a room.')
        onlineQueueSubRef.current = client.subscribe('/user/queue/snl.events', (frame) => {
          try {
            const event = JSON.parse(frame.body || '{}')
            if (event?.type === 'error') {
              setStatus(`Online: ${event?.message || 'Request failed.'}`)
              return
            }

            const roomId = (event?.roomId || '').trim()
            if (roomId) {
              setOnlineRoomId(roomId)
              onlineRoomIdRef.current = roomId
              subscribeOnlineRoom(roomId)
            }
            if (event?.difficulty && DIFFICULTY_PRESETS[event.difficulty]) {
              setDifficulty(event.difficulty)
            }
            if (event?.role === 'host' || event?.role === 'guest') {
              setOnlineRole(event.role)
            }
            if (event?.message) {
              setStatus(`Online: ${event.message}`)
            }
          } catch {
            setStatus('Online: invalid server event.')
          }
        })
      },
      onWebSocketClose: () => {
        setIsOnlineConnected(false)
      },
      onWebSocketError: () => {
        setStatus('Online: connection error.')
      },
      onStompError: () => {
        setStatus('Online: STOMP error.')
      },
    })

    onlineClientRef.current = client
    client.activate()

    return () => {
      teardownOnline(false)
    }
  }, [mode, flow.username, flow.token])

  useEffect(() => () => {
    teardownOnline(false)
  }, [])

  useEffect(() => {
    if (mode !== 'cpu' || winner || turn !== 'opponent') return
    opponentTimerRef.current = setTimeout(() => {
      runTurn('opponent')
      opponentTimerRef.current = null
    }, 900)
    return () => {
      if (opponentTimerRef.current) {
        clearTimeout(opponentTimerRef.current)
        opponentTimerRef.current = null
      }
    }
  }, [turn, winner, mode, positions, difficulty])

  const onCreateOnlineRoom = () => {
    if (!isOnlineConnected) {
      setStatus('Online: waiting for connection.')
      return
    }
    const roomCode = onlineRoomInput.trim().toUpperCase()
    const ok = publishOnline('/app/snl.create', {
      roomId: roomCode || null,
      difficulty,
    })
    if (!ok) setStatus('Online: unable to create room.')
  }

  const onJoinOnlineRoom = () => {
    if (!isOnlineConnected) {
      setStatus('Online: waiting for connection.')
      return
    }
    const roomCode = onlineRoomInput.trim().toUpperCase()
    if (!roomCode) {
      setStatus('Online: enter a room code to join.')
      return
    }
    const ok = publishOnline('/app/snl.join', { roomId: roomCode })
    if (!ok) setStatus('Online: unable to join room.')
  }

  const onLeaveOnlineRoom = () => {
    if (!onlineRoomIdRef.current) return
    publishOnline('/app/snl.leave', { roomId: onlineRoomIdRef.current })
    setOnlineRoomId('')
    onlineRoomIdRef.current = ''
    setOnlineRole('')
    setOnlineHostUsername('')
    setOnlineGuestUsername('')
    setPositions({ you: 1, opponent: 1 })
    positionsRef.current = { you: 1, opponent: 1 }
    setTurn('you')
    setWinner('')
    setDiceValue(null)
    setStatus('Online: left room.')
    onlineRoomSubRef.current?.unsubscribe?.()
    onlineRoomSubRef.current = null
  }

  const onRoll = () => {
    if (winner || isRolling) return
    if (mode === 'online') {
      if (!onlineRoomIdRef.current) {
        setStatus('Online: create or join a room first.')
        return
      }
      const ok = publishOnline('/app/snl.roll', { roomId: onlineRoomIdRef.current })
      if (!ok) setStatus('Online: not connected yet.')
      return
    }
    if (mode === 'cpu' && turn !== 'you') return
    runTurn(turn)
  }

  return (
    <section className="snake-page">
      <header className="snake-header">
        <button className="snake-back-btn" onClick={() => navigate('/games')} aria-label="Back"><BackIcon /></button>
        <h1>Snake & Ladders</h1>
        <span className="snake-header-spacer" aria-hidden="true" />
      </header>

      <div className="snake-card">
        <div className="snake-toolbar">
          <div className="snake-mode-bar" ref={modeMenuRef}>
            <button
              type="button"
              className={`snake-mode-trigger ${isModeMenuOpen ? 'open' : ''}`}
              onClick={() => {
                setIsModeMenuOpen((prev) => !prev)
                setIsDifficultyMenuOpen(false)
              }}
              aria-haspopup="menu"
              aria-expanded={isModeMenuOpen}
              aria-label="Open mode menu"
            >
              Mode: {selectedModeLabel}
              <span className="snake-mode-caret">v</span>
            </button>
            {isModeMenuOpen && (
              <div className="snake-mode-popover" role="menu" aria-label="Mode">
                {MODE_OPTIONS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={mode === item.value}
                    className={`snake-mode-option ${mode === item.value ? 'active' : ''}`}
                    onClick={() => {
                      resetGame(difficulty, item.value)
                      setIsModeMenuOpen(false)
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="snake-difficulty-bar" ref={difficultyMenuRef}>
            <button
              type="button"
              className={`snake-difficulty-trigger ${isDifficultyMenuOpen ? 'open' : ''}`}
              onClick={() => {
                if (mode === 'online' && onlineRoomId) {
                  setStatus('Online: leave room before changing difficulty.')
                  return
                }
                setIsDifficultyMenuOpen((prev) => !prev)
              }}
              aria-haspopup="menu"
              aria-expanded={isDifficultyMenuOpen}
              aria-label="Open difficulty menu"
            >
              Difficulty: {DIFFICULTY_PRESETS[difficulty].label}
              <span className="snake-difficulty-caret">v</span>
            </button>
            {isDifficultyMenuOpen && (
              <div className="snake-difficulty-popover" role="menu" aria-label="Difficulty">
                {DIFFICULTY_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    role="menuitemradio"
                    aria-checked={difficulty === key}
                    className={`snake-difficulty-option ${difficulty === key ? 'active' : ''}`}
                    onClick={() => {
                      resetGame(key, mode)
                      setIsDifficultyMenuOpen(false)
                    }}
                  >
                    {DIFFICULTY_PRESETS[key].label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button type="button" className="snake-reset-btn" onClick={() => resetGame(difficulty, mode)}>
            Restart
          </button>
        </div>

        {mode === 'friend' && (
          <label className="snake-friend-input-wrap" htmlFor="snake-friend-name">
            Friend name:
            <input
              id="snake-friend-name"
              className="snake-friend-input"
              maxLength={24}
              value={friendName}
              onChange={(event) => setFriendName(event.target.value)}
              placeholder="Friend"
            />
          </label>
        )}

        {mode === 'online' && (
          <div className="snake-online-wrap">
            <div className="snake-online-controls">
              <input
                type="text"
                className="snake-online-input"
                placeholder="Room code"
                value={onlineRoomInput}
                onChange={(event) => setOnlineRoomInput(event.target.value.toUpperCase())}
                maxLength={10}
              />
              <button type="button" className="snake-online-btn" onClick={onCreateOnlineRoom}>Create</button>
              <button type="button" className="snake-online-btn" onClick={onJoinOnlineRoom}>Join</button>
              <button type="button" className="snake-online-btn" onClick={onLeaveOnlineRoom} disabled={!onlineRoomId}>Leave</button>
            </div>
            <p className="snake-online-meta">
              {isOnlineConnected ? 'Connected' : 'Connecting...'}
              {onlineRoomId ? ` | Room: ${onlineRoomId}` : ''}
              {onlineRole ? ` | Role: ${onlineRole}` : ''}
              {onlineHostUsername ? ` | Host: ${onlineHostUsername}` : ''}
              {onlineGuestUsername ? ` | Guest: ${onlineGuestUsername}` : ''}
            </p>
          </div>
        )}

        <div className="snake-board-wrap">
          <div className="snake-board">
            <svg className="snake-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient id="ladderWood" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#8b6237" />
                  <stop offset="100%" stopColor="#5d3f24" />
                </linearGradient>
                <linearGradient id="snakeBodyGreen" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#8ccf63" />
                  <stop offset="55%" stopColor="#4f9e39" />
                  <stop offset="100%" stopColor="#327328" />
                </linearGradient>
              </defs>
              {preset.ladders.map(([from, to]) => {
                const a = toCellPoint(from)
                const b = toCellPoint(to)
                const dx = b.x - a.x
                const dy = b.y - a.y
                const length = Math.max(1, Math.hypot(dx, dy))
                const nx = -dy / length
                const ny = dx / length
                const railOffset = 1.22
                const rungHalf = 1.06
                const rungCount = Math.max(4, Math.min(8, Math.floor(length / 9)))
                const rungPoints = Array.from({ length: rungCount }, (_, idx) => {
                  const t = (idx + 1) / (rungCount + 1)
                  return {
                    x: a.x + (b.x - a.x) * t,
                    y: a.y + (b.y - a.y) * t,
                  }
                })
                return (
                  <g key={`ladder-${from}-${to}`} className="ladder-line">
                    <line className="ladder-shadow" x1={a.x - nx * railOffset + 0.15} y1={a.y - ny * railOffset + 0.15} x2={b.x - nx * railOffset + 0.15} y2={b.y - ny * railOffset + 0.15} />
                    <line className="ladder-shadow" x1={a.x + nx * railOffset + 0.15} y1={a.y + ny * railOffset + 0.15} x2={b.x + nx * railOffset + 0.15} y2={b.y + ny * railOffset + 0.15} />
                    <line className="ladder-rail" x1={a.x - nx * railOffset} y1={a.y - ny * railOffset} x2={b.x - nx * railOffset} y2={b.y - ny * railOffset} />
                    <line className="ladder-rail" x1={a.x + nx * railOffset} y1={a.y + ny * railOffset} x2={b.x + nx * railOffset} y2={b.y + ny * railOffset} />
                    {rungPoints.map((point, idx) => (
                      <line
                        key={`rung-${from}-${to}-${idx}`}
                        className="ladder-rung"
                        x1={point.x - nx * rungHalf}
                        y1={point.y - ny * rungHalf}
                        x2={point.x + nx * rungHalf}
                        y2={point.y + ny * rungHalf}
                      />
                    ))}
                  </g>
                )
              })}
              {preset.snakes.map(([from, to]) => {
                const a = toCellPoint(from)
                const b = toCellPoint(to)
                const directionBias = (from + to) % 2 === 0 ? -1 : 1
                const cx = (a.x + b.x) / 2 + directionBias * 4.8
                const cy = (a.y + b.y) / 2
                const pathD = `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`
                return (
                  <g key={`snake-${from}-${to}`} className="snake-group">
                    <path className="snake-path-shadow" d={pathD} />
                    <path className="snake-line" d={pathD} />
                    <path className="snake-line-highlight" d={pathD} />
                    <circle className="snake-tail" cx={b.x} cy={b.y} r="1.06" />
                    <circle className="snake-head" cx={a.x} cy={a.y} r="1.5" />
                    <circle className="snake-eye" cx={a.x - 0.4} cy={a.y - 0.32} r="0.15" />
                    <circle className="snake-eye" cx={a.x + 0.4} cy={a.y - 0.32} r="0.15" />
                  </g>
                )
              })}
            </svg>

            <div className="snake-grid">
              {BOARD_ROWS.flat().map((cell) => (
                <div key={cell} className="snake-cell">
                  <span className="snake-cell-number">{cell}</span>
                  {positions.you === cell && <span className="snake-token snake-token-you">Y</span>}
                  {positions.opponent === cell && <span className="snake-token snake-token-cpu">{mode === 'cpu' ? 'C' : mode === 'online' ? 'O' : 'F'}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="snake-controls">
          <div className="snake-dice-face">{diceValue || '?'}</div>
          <button className="snake-roll-btn" onClick={onRoll} disabled={(mode === 'cpu' && turn !== 'you') || !!winner || isRolling || (mode === 'online' && !onlineRoomId)}>
            {isRolling ? 'Rolling...' : `Roll: ${getPlayerLabel(turn)}`}
          </button>
        </div>

        <div className="snake-status" role="status" aria-live="polite">
          <p>{winner ? `${getPlayerLabel(winner)} reached 100.` : status}</p>
          <p className="snake-turn">{winner ? 'Game over' : `${getPlayerLabel(turn)} Turn`}</p>
        </div>
      </div>
    </section>
  )
}

export default SnakeLadderGamePage
