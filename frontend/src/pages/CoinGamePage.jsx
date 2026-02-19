import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFlowState } from '../hooks/useFlowState'
import { randomPick } from '../lib/gameUtils'
import './CoinGamePage.css'

function CoinGamePage() {
  const navigate = useNavigate()
  const [flow, setFlow] = useFlowState()
  const [text, setText] = useState('Call the toss.')

  useEffect(() => {
    if (!flow.username || !flow.token) navigate('/auth')
  }, [flow.username, flow.token, navigate])

  const unlock = () => {
    if (flow.unlocked) return
    setFlow((prev) => ({ ...prev, unlocked: true }))
  }

  const play = (guess) => {
    const flip = randomPick(['heads', 'tails'])
    if (flip === guess) {
      setText(`Correct: ${flip}`)
      setFlow((prev) => ({
        ...prev,
        wins: {
          rps: prev.wins?.rps || 0,
          coin: (prev.wins?.coin || 0) + 1,
          ttt: prev.wins?.ttt || 0,
        },
      }))
      unlock()
      return
    }
    setText(`Miss: ${flip}`)
  }

  return (
    <section className="single-game-page coin-theme">
      <header className="single-game-top">
        <button onClick={() => navigate('/games')}>Back</button>
        <h2>Heads / Tails</h2>
      </header>

      <div className="coin-stage">
        <img src="/theme/icon-coin.png" alt="Coin" className="single-game-icon" />
        <p>{text}</p>
        <div className="single-game-actions">
          <button onClick={() => play('heads')}>Heads</button>
          <button onClick={() => play('tails')}>Tails</button>
        </div>
      </div>
    </section>
  )
}

export default CoinGamePage
