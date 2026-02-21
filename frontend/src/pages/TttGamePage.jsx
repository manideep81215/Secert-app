import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFlowState } from '../hooks/useFlowState'
import { getTttWinner } from '../lib/gameUtils'
import './TttGamePage.css'

const PLAYER = 'X'
const CPU = 'O'

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
      const cpuMove = getMediumCpuMove(next)
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
