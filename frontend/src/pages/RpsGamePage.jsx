import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFlowState } from '../hooks/useFlowState'
import { randomPick, winsAgainst } from '../lib/gameUtils'
import './RpsGamePage.css'

function RpsGamePage() {
  const navigate = useNavigate()
  const [flow, setFlow] = useFlowState()
  const [text, setText] = useState('Pick one move to start.')

  useEffect(() => {
    if (!flow.username || !flow.token) navigate('/auth')
  }, [flow.username, flow.token, navigate])

  const unlock = () => {
    if (flow.unlocked) return
    setFlow((prev) => ({ ...prev, unlocked: true }))
  }

  const play = (pick) => {
    const cpu = randomPick(['rock', 'paper', 'scissors'])
    if (pick === cpu) {
      setText(`Draw: both picked ${pick}`)
      return
    }
    if (winsAgainst[pick] === cpu) {
      setText(`Win: ${pick} beats ${cpu}`)
      setFlow((prev) => ({
        ...prev,
        wins: {
          rps: (prev.wins?.rps || 0) + 1,
          coin: prev.wins?.coin || 0,
          ttt: prev.wins?.ttt || 0,
        },
      }))
      unlock()
      return
    }
    setText(`Lose: ${cpu} beats ${pick}`)
  }

  return (
    <section className="single-game-page rps-theme">
      <header className="single-game-top">
        <button onClick={() => navigate('/games')}>Back</button>
        <h2>Rock / Paper / Scissors</h2>
      </header>

      <div className="rps-stage">
        <img src="/theme/icon-rock-paper-scissors.png" alt="RPS" className="single-game-icon" />
        <p>{text}</p>
        <div className="single-game-actions">
          <button onClick={() => play('rock')}>Rock</button>
          <button onClick={() => play('paper')}>Paper</button>
          <button onClick={() => play('scissors')}>Scissors</button>
        </div>
      </div>
    </section>
  )
}

export default RpsGamePage
