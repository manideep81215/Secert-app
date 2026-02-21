import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFlowState } from '../hooks/useFlowState'
import { randomPick } from '../lib/gameUtils'
import './CoinGamePage.css'

function CoinGamePage() {
  const navigate = useNavigate()
  const [flow, setFlow] = useFlowState()
  const [round, setRound] = useState(null)

  useEffect(() => {
    if (!flow.username || !flow.token) navigate('/auth')
  }, [flow.username, flow.token, navigate])

  const unlock = () => {
    if (flow.unlocked) return
    setFlow((prev) => ({ ...prev, unlocked: true }))
  }

  const play = (guess) => {
    const flip = randomPick(['heads', 'tails'])
    const win = flip === guess
    setRound({ guess, flip, win })
    if (flip === guess) {
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
  }

  const resultText = (() => {
    if (!round) return 'Call the toss to start the match.'
    if (round.win) return `Hit! The coin landed on ${round.flip === 'heads' ? 'Heads' : 'Tails'}.`
    return `Miss! The coin landed on ${round.flip === 'heads' ? 'Heads' : 'Tails'}.`
  })()

  const yourPickText = round ? (round.guess === 'heads' ? 'Picked: Heads' : 'Picked: Tails') : 'Picked: -'
  const cpuPickText = round ? (round.flip === 'heads' ? 'Result: Heads' : 'Result: Tails') : 'Result: -'
  const yourCoin = round?.guess === 'tails' ? 'T' : 'H'
  const cpuCoin = round?.flip === 'tails' ? 'T' : 'H'

  return (
    <section className="coin-page">
      <header className="coin-header">
        <button className="coin-back-btn" onClick={() => navigate('/games')}>Back</button>
        <h1>Heads / Tails</h1>
      </header>

      <div className="coin-board-wrap">
        <div className="coin-board">
          <div className="coin-vs-grid">
            <article className="coin-player-panel">
              <h3>You</h3>
              <div className="coin-token">{yourCoin}</div>
              <p>{yourPickText}</p>
            </article>

            <div className="coin-vs-mark">VS</div>

            <article className="coin-player-panel">
              <h3>Computer</h3>
              <div className="coin-token">{cpuCoin}</div>
              <p>{cpuPickText}</p>
            </article>
          </div>

          <div className="coin-result-strip">{resultText}</div>
        </div>

        <div className="coin-actions">
          <button onClick={() => play('heads')}>Heads</button>
          <button onClick={() => play('tails')}>Tails</button>
        </div>
      </div>
    </section>
  )
}

export default CoinGamePage
