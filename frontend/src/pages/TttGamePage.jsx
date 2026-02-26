import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFlowState } from '../hooks/useFlowState'
import BackIcon from '../components/BackIcon'
import './TttGamePage.css'

const PLAYER = 'X'
const CPU = 'O'
const TTT_DIFFICULTIES = ['easy', 'medium', 'hard']
const BOARD_LAYOUTS = [3, 4, 5]

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

function TttGamePage() {
  const navigate = useNavigate()
  const [flow, setFlow] = useFlowState()
  const [boardSize, setBoardSize] = useState(3)
  const [board, setBoard] = useState(Array(9).fill(''))
  const [text, setText] = useState('Play as X')
  const [lastMoveIndex, setLastMoveIndex] = useState(null)
  const [difficulty, setDifficulty] = useState('medium')
  const [mode, setMode] = useState('cpu')
  const [friendName, setFriendName] = useState('Friend')
  const [friendTurn, setFriendTurn] = useState(PLAYER)

  useEffect(() => {
    if (!flow.username || !flow.token) navigate('/auth')
  }, [flow.username, flow.token, navigate])

  const unlock = () => {
    if (flow.unlocked) return
    setFlow((prev) => ({ ...prev, unlocked: true }))
  }

  const activeFriendName = friendName.trim() || 'Friend'

  const boardStyle = useMemo(() => ({
    '--ttt-size': String(boardSize),
    '--ttt-board-max': `${Math.min(560, boardSize * 118)}px`,
  }), [boardSize])

  const resetRound = (nextDifficulty = difficulty, nextMode = mode, nextSize = boardSize) => {
    setBoard(Array(nextSize * nextSize).fill(''))
    setLastMoveIndex(null)
    setFriendTurn(PLAYER)
    if (nextMode === 'friend') {
      setText(`${flow.username || 'You'} (X) turn`)
      return
    }
    setText(`Mode: ${nextDifficulty[0].toUpperCase()}${nextDifficulty.slice(1)}`)
  }

  const play = (index) => {
    if (board[index]) return

    if (mode === 'friend') {
      const next = [...board]
      next[index] = friendTurn
      const result = getWinner(next, boardSize)
      setBoard(next)
      setLastMoveIndex(index)

      if (result === 'X') {
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
        setText(`${activeFriendName} won this round`)
        return
      }
      if (result === 'draw') {
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
      setText('CPU won, reset and retry')
      return
    }
    if (result === 'draw') {
      setText('Draw, reset and retry')
      return
    }

    setText(`Mode: ${difficulty[0].toUpperCase()}${difficulty.slice(1)}`)
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
        <div className="ttt-mode-switch" role="group" aria-label="Match mode">
          <button
            type="button"
            className={`ttt-mode-btn ${mode === 'cpu' ? 'active' : ''}`}
            onClick={() => {
              setMode('cpu')
              resetRound(difficulty, 'cpu', boardSize)
            }}
          >
            Vs CPU
          </button>
          <button
            type="button"
            className={`ttt-mode-btn ${mode === 'friend' ? 'active' : ''}`}
            onClick={() => {
              setMode('friend')
              resetRound(difficulty, 'friend', boardSize)
            }}
          >
            Play with Friend
          </button>
        </div>

        <div className="ttt-layout-switch" role="group" aria-label="Board layout">
          {BOARD_LAYOUTS.map((size) => (
            <button
              key={size}
              type="button"
              className={`ttt-layout-btn ${boardSize === size ? 'active' : ''}`}
              onClick={() => {
                setBoardSize(size)
                resetRound(difficulty, mode, size)
              }}
            >
              {size}x{size}
            </button>
          ))}
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
        ) : (
          <div className="ttt-difficulty-bar">
            <label className="ttt-difficulty-select-wrap" htmlFor="ttt-difficulty-select">
              Difficulty:
              <select
                id="ttt-difficulty-select"
                className="ttt-difficulty-select"
                value={difficulty}
                onChange={(event) => {
                  const nextDifficulty = event.target.value
                  setDifficulty(nextDifficulty)
                  resetRound(nextDifficulty, mode, boardSize)
                }}
              >
                {TTT_DIFFICULTIES.map((currentDifficulty) => (
                  <option key={currentDifficulty} value={currentDifficulty}>
                    {currentDifficulty[0].toUpperCase() + currentDifficulty.slice(1)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <div className="ttt-board-grid" style={boardStyle}>
          {board.map((cell, index) => (
            <button
              key={index}
              onClick={() => play(index)}
              className={`ttt-board-cell ${lastMoveIndex === index && cell ? 'ttt-board-cell-last' : ''}`}
            >
              {cell || '-'}
            </button>
          ))}
        </div>
        <div className="ttt-bottom">
          <p>{text}</p>
          <button onClick={() => resetRound()}>Reset</button>
        </div>
      </div>
    </section>
  )
}

export default TttGamePage
