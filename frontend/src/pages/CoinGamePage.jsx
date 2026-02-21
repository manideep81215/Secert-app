import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFlowState } from '../hooks/useFlowState'
import { randomPick } from '../lib/gameUtils'
import './CoinGamePage.css'

function CoinGamePage() {
  const navigate = useNavigate()
  const [flow, setFlow] = useFlowState()
  const [round, setRound] = useState(null)
  const [isResolving, setIsResolving] = useState(false)

  useEffect(() => {
    if (!flow.username || !flow.token) navigate('/auth')
  }, [flow.username, flow.token, navigate])

  const unlock = () => {
    if (flow.unlocked) return
    setFlow((prev) => ({ ...prev, unlocked: true }))
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  const play = async (guess) => {
    if (isResolving) return
    setIsResolving(true)
    setRound({ guess, flip: null, win: false })
    await sleep(850)

    const flip = randomPick(['heads', 'tails'])
    const win = flip === guess
    setRound({ guess, flip, win })
    setIsResolving(false)
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
    if (isResolving) return 'Flipping coin...'
    if (!round) return 'Call the toss to start the match.'
    if (round.win) return `Hit! The coin landed on ${round.flip === 'heads' ? 'Heads' : 'Tails'}.`
    return `Miss! The coin landed on ${round.flip === 'heads' ? 'Heads' : 'Tails'}.`
  })()

  const yourPickText = round ? (round.guess === 'heads' ? 'Picked: Heads' : 'Picked: Tails') : 'Picked: -'
  const cpuPickText = round ? (round.flip ? (round.flip === 'heads' ? 'Result: Heads' : 'Result: Tails') : 'Result: ...') : 'Result: -'
  const yourCoin = round?.guess === 'tails' ? 'T' : 'H'
  const cpuCoin = round?.flip ? (round.flip === 'tails' ? 'T' : 'H') : '?'

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
          <button onClick={() => play('heads')} disabled={isResolving}>{isResolving ? '...' : 'Heads'}</button>
          <button onClick={() => play('tails')} disabled={isResolving}>{isResolving ? '...' : 'Tails'}</button>
        </div>
        {isResolving && <div className="game-loading-inline" aria-live="polite"><span className="game-spinner" />Processing...</div>}
      </div>
    </section>
  )
}

export default CoinGamePage
