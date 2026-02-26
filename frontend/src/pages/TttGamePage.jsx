import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Client } from '@stomp/stompjs'
import SockJS from 'sockjs-client'
import { toast } from 'react-toastify'
import { useFlowState } from '../hooks/useFlowState'
import BackIcon from '../components/BackIcon'
import { WS_CHAT_URL } from '../config/apiConfig'
import './TttGamePage.css'

const PLAYER = 'X'
const CPU = 'O'
const TTT_DIFFICULTIES = ['easy', 'medium', 'hard']
const BOARD_LAYOUTS = [3, 4, 5]
const MODE_OPTIONS = [
  { value: 'cpu', label: 'Vs CPU' },
  { value: 'friend', label: 'Play with Friend' },
  { value: 'online', label: 'Online Multiplayer' },
]

function getWinner(board, size) {
  for (let row = 0; row < size; row += 1) {
    const start = row * size
    const first = board[start]
    if (first && Array.from({ length: size }).every((_, col) => board[start + col] === first)) {
      return first
    }
  }

  for (let col = 0; col < size; col += 1) {
    const first = board[col]
    if (first && Array.from({ length: size }).every((_, row) => board[row * size + col] === first)) {
      return first
    }
  }

  const diagonalFirst = board[0]
  if (diagonalFirst && Array.from({ length: size }).every((_, idx) => board[idx * (size + 1)] === diagonalFirst)) {
    return diagonalFirst
  }

  const antiDiagonalFirst = board[size - 1]
  if (
    antiDiagonalFirst
    && Array.from({ length: size }).every((_, idx) => board[(idx + 1) * (size - 1)] === antiDiagonalFirst)
  ) {
    return antiDiagonalFirst
  }

  if (board.every(Boolean)) return 'draw'
  return ''
}

function getFreeCells(board) {
  return board.map((cell, idx) => (cell ? null : idx)).filter((idx) => idx !== null)
}

function findWinningMove(board, size, mark) {
  const free = getFreeCells(board)
  for (const idx of free) {
    const next = [...board]
    next[idx] = mark
    if (getWinner(next, size) === mark) return idx
  }
  return -1
}

function pickRandom(items) {
  if (!items.length) return -1
  return items[Math.floor(Math.random() * items.length)]
}

function getCornerIndexes(size) {
  return [0, size - 1, size * (size - 1), size * size - 1]
}

function getCenterIndex(size) {
  if (size % 2 === 0) return -1
  const mid = Math.floor(size / 2)
  return mid * size + mid
}

function getMediumCpuMove(board, size) {
  const free = getFreeCells(board)
  if (!free.length) return -1

  const winning = findWinningMove(board, size, CPU)
  if (winning >= 0) return winning

  const block = findWinningMove(board, size, PLAYER)
  if (block >= 0) return block

  const center = getCenterIndex(size)
  if (center >= 0 && free.includes(center) && Math.random() < 0.65) return center

  const corners = getCornerIndexes(size).filter((idx) => free.includes(idx))
  if (corners.length && Math.random() < 0.55) {
    return pickRandom(corners)
  }

  return pickRandom(free)
}

function minimax(board, isCpuTurn, size) {
  const winner = getWinner(board, size)
  if (winner === CPU) return { score: 10 }
  if (winner === PLAYER) return { score: -10 }
  if (winner === 'draw') return { score: 0 }

  const free = getFreeCells(board)
  if (!free.length) return { score: 0 }

  let bestMove = { score: isCpuTurn ? -Infinity : Infinity, index: free[0] }
  for (const idx of free) {
    const next = [...board]
    next[idx] = isCpuTurn ? CPU : PLAYER
    const result = minimax(next, !isCpuTurn, size)
    if (isCpuTurn) {
      if (result.score > bestMove.score) bestMove = { score: result.score, index: idx }
    } else if (result.score < bestMove.score) {
      bestMove = { score: result.score, index: idx }
    }
  }
  return bestMove
}

function getHardCpuMove(board, size) {
  if (size !== 3) return getMediumCpuMove(board, size)
  const best = minimax(board, true, size)
  return Number.isInteger(best?.index) ? best.index : -1
}

function getEasyCpuMove(board) {
  return pickRandom(getFreeCells(board))
}

function normalizeUsername(value) {
  return (value || '').trim().toLowerCase()
}

function TttGamePage() {
  const navigate = useNavigate()
  const [flow, setFlow] = useFlowState()
  const [boardSize, setBoardSize] = useState(3)
  const [board, setBoard] = useState(Array(9).fill(''))
  const [text, setText] = useState('Play as X')
  const [matchEnded, setMatchEnded] = useState(false)
  const [lastMoveIndex, setLastMoveIndex] = useState(null)
  const [difficulty, setDifficulty] = useState('medium')
  const [mode, setMode] = useState('cpu')
  const [friendName, setFriendName] = useState('Friend')
  const [friendTurn, setFriendTurn] = useState(PLAYER)
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false)
  const [isLayoutMenuOpen, setIsLayoutMenuOpen] = useState(false)
  const [isDifficultyMenuOpen, setIsDifficultyMenuOpen] = useState(false)
  const [onlineRoomInput, setOnlineRoomInput] = useState('')
  const [onlineRoomId, setOnlineRoomId] = useState('')
  const [onlineMark, setOnlineMark] = useState('')
  const [onlineTurnMark, setOnlineTurnMark] = useState('X')
  const [onlineXPlayer, setOnlineXPlayer] = useState('')
  const [onlineOPlayer, setOnlineOPlayer] = useState('')
  const [isOnlineConnected, setIsOnlineConnected] = useState(false)
  const modeMenuRef = useRef(null)
  const layoutMenuRef = useRef(null)
  const difficultyMenuRef = useRef(null)
  const onlineClientRef = useRef(null)
  const onlineRoomSubRef = useRef(null)
  const onlineQueueSubRef = useRef(null)
  const onlineRoomIdRef = useRef('')
  const awardedWinRef = useRef('')
  const onlinePresenceToastRef = useRef('')

  useEffect(() => {
    if (!flow.username || !flow.token) navigate('/auth')
  }, [flow.username, flow.token, navigate])

  useEffect(() => {
    const handleOutsidePress = (event) => {
      if (!modeMenuRef.current?.contains(event.target)) setIsModeMenuOpen(false)
      if (!layoutMenuRef.current?.contains(event.target)) setIsLayoutMenuOpen(false)
      if (!difficultyMenuRef.current?.contains(event.target)) setIsDifficultyMenuOpen(false)
    }
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setIsModeMenuOpen(false)
        setIsLayoutMenuOpen(false)
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

  const unlock = () => {
    if (flow.unlocked) return
    setFlow((prev) => ({ ...prev, unlocked: true }))
  }

  const activeFriendName = friendName.trim() || 'Friend'
  const selectedModeLabel = MODE_OPTIONS.find((item) => item.value === mode)?.label || 'Vs CPU'
  const selectedDifficultyLabel = `${difficulty[0].toUpperCase()}${difficulty.slice(1)}`
  const hasOnlinePair = Boolean(onlineXPlayer && onlineOPlayer)
  const isOnlineMyTurn = Boolean(onlineMark && onlineTurnMark && onlineMark === onlineTurnMark)

  const boardStyle = useMemo(() => ({
    '--ttt-size': String(boardSize),
    '--ttt-board-max': `${Math.min(560, boardSize * 118)}px`,
  }), [boardSize])

  const resetRound = (nextDifficulty = difficulty, nextMode = mode, nextSize = boardSize) => {
    setBoard(Array(nextSize * nextSize).fill(''))
    setLastMoveIndex(null)
    setMatchEnded(false)
    setFriendTurn(PLAYER)
    if (nextMode === 'friend') {
      setText(`${flow.username || 'You'} (X) turn`)
      return
    }
    if (nextMode === 'online') {
      setText('Online mode ready. Create or join a room.')
      return
    }
    setText(`Mode: ${nextDifficulty[0].toUpperCase()}${nextDifficulty.slice(1)}`)
  }

  const publishOnline = (destination, body) => {
    const client = onlineClientRef.current
    if (!client || !client.connected) return false
    client.publish({
      destination,
      body: JSON.stringify(body),
    })
    return true
  }

  const awardOnlineWinIfNeeded = (winner, roomId, updatedAt, mark) => {
    if (!winner || winner === 'draw' || !mark || winner !== mark) return
    const key = `${roomId}:${updatedAt}:${winner}`
    if (awardedWinRef.current === key) return
    awardedWinRef.current = key
    setFlow((prev) => ({
      ...prev,
      wins: {
        rps: prev.wins?.rps || 0,
        coin: prev.wins?.coin || 0,
        ttt: (prev.wins?.ttt || 0) + 1,
      },
    }))
    unlock()
  }

  const applyOnlineState = (event) => {
    const size = Number(event?.size || 0)
    if (size >= 3 && size <= 5) {
      setBoardSize(size)
    }

    const nextBoard = Array.isArray(event?.board) ? event.board : []
    if (nextBoard.length) {
      setBoard(nextBoard.map((cell) => (cell || '')))
    }

    setLastMoveIndex(Number.isInteger(event?.lastMoveIndex) ? event.lastMoveIndex : null)
    setOnlineRoomId(event?.roomId || '')
    onlineRoomIdRef.current = event?.roomId || ''

    const xPlayer = normalizeUsername(event?.xPlayer)
    const oPlayer = normalizeUsername(event?.oPlayer)
    setOnlineXPlayer(xPlayer)
    setOnlineOPlayer(oPlayer)
    const turn = event?.turn === 'O' ? 'O' : 'X'
    setOnlineTurnMark(turn)

    const me = normalizeUsername(flow.username)
    const myMark = me && me === xPlayer ? 'X' : me && me === oPlayer ? 'O' : ''
    if (myMark) {
      setOnlineMark(myMark)
      awardOnlineWinIfNeeded(event?.winner, event?.roomId || '', event?.updatedAt || Date.now(), myMark)
    }

    if (event?.winner === 'draw') {
      setMatchEnded(true)
      setText('Online: draw match.')
      return
    }
    if (event?.winner === 'X' || event?.winner === 'O') {
      setMatchEnded(true)
      const winnerName = event.winner === 'X' ? (xPlayer || 'X') : (oPlayer || 'O')
      setText(`Online: ${winnerName} won.`)
      return
    }
    setMatchEnded(false)

    if (!xPlayer || !oPlayer) {
      setText('Online: waiting for both players.')
      return
    }

    const turnName = turn === 'X' ? xPlayer : oPlayer
    const msg = String(event?.message || '')
    const toastKey = `${event?.roomId || ''}:${event?.updatedAt || ''}:${msg}`
    if (msg && onlinePresenceToastRef.current !== toastKey) {
      if (msg.toLowerCase().includes('both players connected')) {
        toast.success('Opponent joined the room.')
        onlinePresenceToastRef.current = toastKey
      } else if (msg.toLowerCase().includes('left')) {
        toast.info('A player left the room.')
        onlinePresenceToastRef.current = toastKey
      }
    }
    setText(`Online: ${turnName} turn (${turn}).`)
  }

  const subscribeToRoom = (roomId) => {
    const client = onlineClientRef.current
    if (!client || !client.connected || !roomId) return

    onlineRoomSubRef.current?.unsubscribe?.()
    onlineRoomSubRef.current = client.subscribe(`/topic/ttt.room.${roomId}`, (frame) => {
      try {
        const event = JSON.parse(frame.body || '{}')
        applyOnlineState(event)
      } catch {
        setText('Online: invalid room update.')
      }
    })
  }

  const teardownOnline = (sendLeave = true) => {
    try {
      if (sendLeave && onlineRoomIdRef.current) {
        publishOnline('/app/ttt.leave', { roomId: onlineRoomIdRef.current })
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
    setIsOnlineConnected(false)
    setOnlineRoomId('')
    setOnlineMark('')
    setOnlineTurnMark('X')
    setOnlineXPlayer('')
    setOnlineOPlayer('')
    setOnlineRoomInput('')
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
        setText('Online connected. Create or join a room.')
        onlineQueueSubRef.current = client.subscribe('/user/queue/ttt.events', (frame) => {
          try {
            const event = JSON.parse(frame.body || '{}')
            if (event?.type === 'error') {
              setText(`Online: ${event?.message || 'Request failed.'}`)
              return
            }

            const roomId = (event?.roomId || '').trim()
            if (roomId) {
              setOnlineRoomId(roomId)
              onlineRoomIdRef.current = roomId
              subscribeToRoom(roomId)
            }

            const size = Number(event?.size || 0)
            if (size >= 3 && size <= 5) {
              setBoardSize(size)
              setBoard(Array(size * size).fill(''))
            }
            if (Array.isArray(event?.board) && event.board.length) {
              setBoard(event.board.map((cell) => (cell || '')))
            }
            if (event?.yourMark === 'X' || event?.yourMark === 'O') {
              setOnlineMark(event.yourMark)
            }
    if (event?.message) {
      const msg = String(event.message)
      const toastKey = `${event?.roomId || ''}:${event?.updatedAt || ''}:${msg}`
      if (onlinePresenceToastRef.current !== toastKey) {
        if (msg.toLowerCase().includes('both players connected')) {
          toast.success('Opponent joined the room.')
          onlinePresenceToastRef.current = toastKey
        } else if (msg.toLowerCase().includes('left')) {
          toast.info('A player left the room.')
          onlinePresenceToastRef.current = toastKey
        }
      }
      setText(`Online: ${event.message}`)
    }
          } catch {
            setText('Online: invalid server event.')
          }
        })
      },
      onWebSocketClose: () => {
        setIsOnlineConnected(false)
      },
      onWebSocketError: () => {
        setText('Online: connection error.')
      },
      onStompError: () => {
        setText('Online: STOMP error.')
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

  const play = (index) => {
    if (mode === 'online') {
      if (!onlineRoomIdRef.current) {
        setText('Online: create or join a room first.')
        return
      }
      if (!hasOnlinePair) {
        setText('Online: waiting for opponent to join.')
        return
      }
      if (!isOnlineMyTurn) {
        setText('Online: not your turn yet.')
        return
      }
      const ok = publishOnline('/app/ttt.move', {
        roomId: onlineRoomIdRef.current,
        index,
      })
      if (!ok) {
        setText('Online: not connected yet.')
      }
      return
    }

    if (board[index]) return

    if (mode === 'friend') {
      const next = [...board]
      next[index] = friendTurn
      const result = getWinner(next, boardSize)
      setBoard(next)
      setLastMoveIndex(index)

      if (result === 'X') {
        setMatchEnded(true)
        setText(`${flow.username || 'You'} won this round`)
        setFlow((prev) => ({
          ...prev,
          wins: {
            rps: prev.wins?.rps || 0,
            coin: prev.wins?.coin || 0,
            ttt: (prev.wins?.ttt || 0) + 1,
          },
        }))
        unlock()
        return
      }
      if (result === 'O') {
        setMatchEnded(true)
        setText(`${activeFriendName} won this round`)
        return
      }
      if (result === 'draw') {
        setMatchEnded(true)
        setText('Draw, reset and retry')
        return
      }

      const nextTurn = friendTurn === PLAYER ? CPU : PLAYER
      setFriendTurn(nextTurn)
      setText(nextTurn === PLAYER ? `${flow.username || 'You'} (X) turn` : `${activeFriendName} (O) turn`)
      return
    }

    const next = [...board]
    next[index] = PLAYER
    let latestMove = index
    let result = getWinner(next, boardSize)

    if (!result) {
      const cpuMove =
        difficulty === 'easy'
          ? getEasyCpuMove(next)
          : difficulty === 'hard'
            ? getHardCpuMove(next, boardSize)
            : getMediumCpuMove(next, boardSize)
      if (cpuMove >= 0) {
        next[cpuMove] = CPU
        latestMove = cpuMove
      }
      result = getWinner(next, boardSize)
    }

    setBoard(next)
    setLastMoveIndex(latestMove)

    if (result === 'X') {
      setMatchEnded(true)
      setText('You won this round')
      setFlow((prev) => ({
        ...prev,
        wins: {
          rps: prev.wins?.rps || 0,
          coin: prev.wins?.coin || 0,
          ttt: (prev.wins?.ttt || 0) + 1,
        },
      }))
      unlock()
      return
    }
    if (result === 'O') {
      setMatchEnded(true)
      setText('CPU won, reset and retry')
      return
    }
    if (result === 'draw') {
      setMatchEnded(true)
      setText('Draw, reset and retry')
      return
    }

    setText(`Mode: ${difficulty[0].toUpperCase()}${difficulty.slice(1)}`)
  }

  const onCreateRoom = () => {
    if (!isOnlineConnected) {
      setText('Online: waiting for connection.')
      return
    }
    const roomCode = onlineRoomInput.trim().toUpperCase()
    const ok = publishOnline('/app/ttt.create', {
      roomId: roomCode || null,
      size: boardSize,
    })
    if (!ok) setText('Online: unable to create room.')
  }

  const onJoinRoom = () => {
    if (!isOnlineConnected) {
      setText('Online: waiting for connection.')
      return
    }
    const roomCode = onlineRoomInput.trim().toUpperCase()
    if (!roomCode) {
      setText('Online: enter a room code to join.')
      return
    }
    const ok = publishOnline('/app/ttt.join', { roomId: roomCode })
    if (!ok) setText('Online: unable to join room.')
  }

  const onLeaveRoom = () => {
    if (!onlineRoomIdRef.current) return
    publishOnline('/app/ttt.leave', { roomId: onlineRoomIdRef.current })
    setBoard(Array(boardSize * boardSize).fill(''))
    setLastMoveIndex(null)
    setOnlineRoomId('')
    onlineRoomIdRef.current = ''
    setOnlineMark('')
    setOnlineTurnMark('X')
    setOnlineXPlayer('')
    setOnlineOPlayer('')
    setText('Online: left room.')
    onlineRoomSubRef.current?.unsubscribe?.()
    onlineRoomSubRef.current = null
  }

  const onReplay = () => {
    if (mode === 'online' && onlineRoomIdRef.current) {
      const ok = publishOnline('/app/ttt.replay', { roomId: onlineRoomIdRef.current })
      if (!ok) {
        setText('Online: unable to start replay.')
      } else {
        setMatchEnded(false)
      }
      return
    }
    resetRound()
  }

  return (
    <section className="single-game-page ttt-theme">
      <header className="single-game-top">
        <button onClick={() => navigate('/games')} aria-label="Back"><BackIcon /></button>
        <h2>Tic-Tac-Toe</h2>
        <span className="single-game-top-spacer" aria-hidden="true" />
      </header>

      <div className="ttt-stage">
        <img src="/theme/icon-tic-tac-toe.png" alt="Tic Tac Toe" className="single-game-icon" />
        <div className="ttt-dropdown-wrap" ref={modeMenuRef}>
          <button
            type="button"
            className={`ttt-dropdown-trigger ${isModeMenuOpen ? 'open' : ''}`}
            onClick={() => {
              setIsModeMenuOpen((prev) => !prev)
              setIsLayoutMenuOpen(false)
              setIsDifficultyMenuOpen(false)
            }}
            aria-haspopup="menu"
            aria-expanded={isModeMenuOpen}
          >
            Mode: {selectedModeLabel}
            <span className="ttt-dropdown-caret">v</span>
          </button>
          {isModeMenuOpen && (
            <div className="ttt-dropdown-popover" role="menu" aria-label="Match mode">
              {MODE_OPTIONS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={mode === item.value}
                  className={`ttt-dropdown-option ${mode === item.value ? 'active' : ''}`}
                  onClick={() => {
                    setMode(item.value)
                    resetRound(difficulty, item.value, boardSize)
                    setIsModeMenuOpen(false)
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="ttt-dropdown-wrap" ref={layoutMenuRef}>
          <button
            type="button"
            className={`ttt-dropdown-trigger ${isLayoutMenuOpen ? 'open' : ''}`}
            onClick={() => {
              if (mode === 'online' && onlineRoomId) return
              setIsLayoutMenuOpen((prev) => !prev)
              setIsDifficultyMenuOpen(false)
            }}
            aria-haspopup="menu"
            aria-expanded={isLayoutMenuOpen}
          >
            Layout: {boardSize}x{boardSize}
            <span className="ttt-dropdown-caret">v</span>
          </button>
          {isLayoutMenuOpen && (
            <div className="ttt-dropdown-popover" role="menu" aria-label="Board layout">
              {BOARD_LAYOUTS.map((size) => (
                <button
                  key={size}
                  type="button"
                  role="menuitemradio"
                  aria-checked={boardSize === size}
                  className={`ttt-dropdown-option ${boardSize === size ? 'active' : ''}`}
                  onClick={() => {
                    if (mode === 'online' && onlineRoomId) {
                      setText('Online: leave room before changing layout.')
                      setIsLayoutMenuOpen(false)
                      return
                    }
                    setBoardSize(size)
                    resetRound(difficulty, mode, size)
                    setIsLayoutMenuOpen(false)
                  }}
                >
                  {size}x{size}
                </button>
              ))}
            </div>
          )}
        </div>

        {mode === 'friend' ? (
          <label className="ttt-friend-input-wrap" htmlFor="ttt-friend-name">
            Friend name:
            <input
              id="ttt-friend-name"
              className="ttt-friend-input"
              maxLength={24}
              value={friendName}
              onChange={(event) => setFriendName(event.target.value)}
              placeholder="Friend"
            />
          </label>
        ) : mode === 'online' ? (
          <div className="ttt-online-wrap">
            <div className="ttt-online-controls">
              <input
                type="text"
                className="ttt-online-input"
                placeholder="Room code"
                value={onlineRoomInput}
                onChange={(event) => setOnlineRoomInput(event.target.value.toUpperCase())}
                maxLength={10}
              />
              <div className="ttt-online-actions">
                {!onlineRoomId && <button type="button" className="ttt-online-btn" onClick={onCreateRoom}>Create</button>}
                {!onlineRoomId && <button type="button" className="ttt-online-btn" onClick={onJoinRoom}>Join</button>}
                <button type="button" className="ttt-online-btn" onClick={onLeaveRoom} disabled={!onlineRoomId}>Leave</button>
              </div>
            </div>
            <p className="ttt-online-meta">
              {isOnlineConnected ? 'Connected' : 'Connecting...'}
              {onlineRoomId ? ` | Room: ${onlineRoomId}` : ''}
              {onlineMark ? ` | You: ${onlineMark}` : ''}
              {onlineXPlayer ? ` | X: ${onlineXPlayer}` : ''}
              {onlineOPlayer ? ` | O: ${onlineOPlayer}` : ''}
            </p>
          </div>
        ) : (
          <div className="ttt-dropdown-wrap" ref={difficultyMenuRef}>
            <button
              type="button"
              className={`ttt-dropdown-trigger ${isDifficultyMenuOpen ? 'open' : ''}`}
              onClick={() => {
                setIsDifficultyMenuOpen((prev) => !prev)
                setIsLayoutMenuOpen(false)
              }}
              aria-haspopup="menu"
              aria-expanded={isDifficultyMenuOpen}
            >
              Difficulty: {selectedDifficultyLabel}
              <span className="ttt-dropdown-caret">v</span>
            </button>
            {isDifficultyMenuOpen && (
              <div className="ttt-dropdown-popover" role="menu" aria-label="Difficulty">
                {TTT_DIFFICULTIES.map((currentDifficulty) => (
                  <button
                    key={currentDifficulty}
                    type="button"
                    role="menuitemradio"
                    aria-checked={difficulty === currentDifficulty}
                    className={`ttt-dropdown-option ${difficulty === currentDifficulty ? 'active' : ''}`}
                    onClick={() => {
                      setDifficulty(currentDifficulty)
                      resetRound(currentDifficulty, mode, boardSize)
                      setIsDifficultyMenuOpen(false)
                    }}
                  >
                    {currentDifficulty[0].toUpperCase() + currentDifficulty.slice(1)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="ttt-board-grid" style={boardStyle}>
          {board.map((cell, index) => (
            <button
              key={index}
              onClick={() => play(index)}
              disabled={
                mode === 'online'
                && (
                  !onlineRoomId
                  || !hasOnlinePair
                  || !isOnlineMyTurn
                  || Boolean(cell)
                )
              }
              className={`ttt-board-cell ${lastMoveIndex === index && cell ? 'ttt-board-cell-last' : ''}`}
            >
              {cell || '-'}
            </button>
          ))}
        </div>
        <div className="ttt-bottom">
          <p>{text}</p>
          <button onClick={onReplay}>{matchEnded ? 'Replay' : 'Reset'}</button>
        </div>
      </div>
    </section>
  )
}

export default TttGamePage
