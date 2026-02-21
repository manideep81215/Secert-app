import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFlowState } from '../hooks/useFlowState'
import { getTttWinner } from '../lib/gameUtils'
import './TttGamePage.css'

const PLAYER = 'X'
const CPU = 'O'
const TTT_DIFFICULTIES = ['easy', 'medium', 'hard']

function getFreeCells(board) {
  return board.map((cell, idx) => (cell ? null : idx)).filter((idx) => idx !== null)
}

function findWinningMove(board, mark) {
  const free = getFreeCells(board)
  for (const idx of free) {
    const next = [...board]
    next[idx] = mark
    if (getTttWinner(next) === mark) return idx
  }
  return -1
}

function pickRandom(items) {
  if (!items.length) return -1
  return items[Math.floor(Math.random() * items.length)]
}

function getMediumCpuMove(board) {
  const free = getFreeCells(board)
  if (!free.length) return -1

  const winning = findWinningMove(board, CPU)
  if (winning >= 0) return winning

  const block = findWinningMove(board, PLAYER)
  if (block >= 0) return block

  if (free.includes(4) && Math.random() < 0.65) return 4

  const corners = [0, 2, 6, 8].filter((idx) => free.includes(idx))
  if (corners.length && Math.random() < 0.55) {
    return pickRandom(corners)
  }

  return pickRandom(free)
}

function minimax(board, isCpuTurn) {
  const winner = getTttWinner(board)
  if (winner === CPU) return { score: 10 }
  if (winner === PLAYER) return { score: -10 }
  if (winner === 'draw') return { score: 0 }

  const free = getFreeCells(board)
  if (!free.length) return { score: 0 }

  let bestMove = { score: isCpuTurn ? -Infinity : Infinity, index: free[0] }
  for (const idx of free) {
    const next = [...board]
    next[idx] = isCpuTurn ? CPU : PLAYER
    const result = minimax(next, !isCpuTurn)
    if (isCpuTurn) {
      if (result.score > bestMove.score) bestMove = { score: result.score, index: idx }
    } else if (result.score < bestMove.score) {
      bestMove = { score: result.score, index: idx }
    }
  }
  return bestMove
}

function getHardCpuMove(board) {
  const best = minimax(board, true)
  return Number.isInteger(best?.index) ? best.index : -1
}

function getEasyCpuMove(board) {
  return pickRandom(getFreeCells(board))
}

function TttGamePage() {
  const navigate = useNavigate()
  const [flow, setFlow] = useFlowState()
  const [board, setBoard] = useState(Array(9).fill(''))
  const [text, setText] = useState('Play as X')
  const [lastMoveIndex, setLastMoveIndex] = useState(null)
  const [difficulty, setDifficulty] = useState('medium')

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
    let latestMove = index
    let result = getTttWinner(next)

    if (!result) {
      const cpuMove =
        difficulty === 'easy'
          ? getEasyCpuMove(next)
          : difficulty === 'hard'
            ? getHardCpuMove(next)
            : getMediumCpuMove(next)
      if (cpuMove >= 0) {
        next[cpuMove] = CPU
        latestMove = cpuMove
      }
      result = getTttWinner(next)
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
        <button onClick={() => navigate('/games')}>Back</button>
        <h2>Tic-Tac-Toe</h2>
        <span className="single-game-top-spacer" aria-hidden="true" />
      </header>

      <div className="ttt-stage">
        <img src="/theme/icon-tic-tac-toe.png" alt="Tic Tac Toe" className="single-game-icon" />
        <div className="ttt-difficulty-bar">
          <span className="ttt-difficulty-label">Difficulty</span>
          <div className="ttt-difficulty-menu" role="group" aria-label="Tic Tac Toe difficulty">
            {TTT_DIFFICULTIES.map((mode) => (
              <button
                key={mode}
                type="button"
                className={`ttt-difficulty-btn ${difficulty === mode ? 'active' : ''}`}
                onClick={() => {
                  setDifficulty(mode)
                  setBoard(Array(9).fill(''))
                  setLastMoveIndex(null)
                  setText(`Mode: ${mode[0].toUpperCase()}${mode.slice(1)}`)
                }}
              >
                {mode[0].toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="ttt-board-grid">
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
          <button onClick={() => { setBoard(Array(9).fill('')); setText(`Mode: ${difficulty[0].toUpperCase()}${difficulty.slice(1)}`); setLastMoveIndex(null) }}>Reset</button>
        </div>
      </div>
    </section>
  )
}

export default TttGamePage
