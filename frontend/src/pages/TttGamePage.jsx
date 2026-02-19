import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFlowState } from '../hooks/useFlowState'
import { getTttWinner } from '../lib/gameUtils'
import './TttGamePage.css'

const PLAYER = 'X'
const CPU = 'O'

function scoreBoard(board, depth) {
  const winner = getTttWinner(board)
  if (winner === CPU) return 10 - depth
  if (winner === PLAYER) return depth - 10
  if (winner === 'draw') return 0
  return null
}

function minimax(board, depth, isCpuTurn) {
  const score = scoreBoard(board, depth)
  if (score !== null) return score

  const free = board.map((cell, idx) => (cell ? null : idx)).filter((idx) => idx !== null)

  if (isCpuTurn) {
    let best = -Infinity
    for (const idx of free) {
      board[idx] = CPU
      best = Math.max(best, minimax(board, depth + 1, false))
      board[idx] = ''
    }
    return best
  }

  let best = Infinity
  for (const idx of free) {
    board[idx] = PLAYER
    best = Math.min(best, minimax(board, depth + 1, true))
    board[idx] = ''
  }
  return best
}

function getBestCpuMove(board) {
  const free = board.map((cell, idx) => (cell ? null : idx)).filter((idx) => idx !== null)
  let bestScore = -Infinity
  let bestMove = free[0] ?? -1

  for (const idx of free) {
    board[idx] = CPU
    const score = minimax(board, 0, false)
    board[idx] = ''
    if (score > bestScore) {
      bestScore = score
      bestMove = idx
    }
  }

  return bestMove
}

function TttGamePage() {
  const navigate = useNavigate()
  const [flow, setFlow] = useFlowState()
  const [board, setBoard] = useState(Array(9).fill(''))
  const [text, setText] = useState('Play as X')

  useEffect(() => {
    if (!flow.username || !flow.token) navigate('/auth')
  }, [flow.username, flow.token, navigate])

  const unlock = () => {
    if (flow.unlocked) return
    setFlow((prev) => ({ ...prev, unlocked: true }))
  }

  const play = (index) => {
    if (board[index]) return

    const next = [...board]
    next[index] = PLAYER
    let result = getTttWinner(next)

    if (!result) {
      const cpuMove = getBestCpuMove(next)
      if (cpuMove >= 0) {
        next[cpuMove] = CPU
      }
      result = getTttWinner(next)
    }

    setBoard(next)

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
    }
  }

  return (
    <section className="single-game-page ttt-theme">
      <header className="single-game-top">
        <button onClick={() => navigate('/games')}>Back</button>
        <h2>Tic-Tac-Toe</h2>
      </header>

      <div className="ttt-stage">
        <img src="/theme/icon-tic-tac-toe.png" alt="Tic Tac Toe" className="single-game-icon" />
        <div className="ttt-board-grid">
          {board.map((cell, index) => (
            <button key={index} onClick={() => play(index)} className="ttt-board-cell">{cell || '-'}</button>
          ))}
        </div>
        <div className="ttt-bottom">
          <p>{text}</p>
          <button onClick={() => { setBoard(Array(9).fill('')); setText('Play as X') }}>Reset</button>
        </div>
      </div>
    </section>
  )
}

export default TttGamePage
