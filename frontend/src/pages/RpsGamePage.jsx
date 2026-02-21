import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFlowState } from '../hooks/useFlowState'
import { randomPick, winsAgainst } from '../lib/gameUtils'
import './RpsGamePage.css'

function RpsGamePage() {
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

  const play = async (pick) => {
    if (isResolving) return
    setIsResolving(true)
    setRound({ pick, cpu: null, draw: false, win: false })
    await sleep(850)

    const cpu = randomPick(['rock', 'paper', 'scissors'])
    const draw = pick === cpu
    const win = !draw && winsAgainst[pick] === cpu
    setRound({ pick, cpu, draw, win })
    setIsResolving(false)

    if (pick === cpu) {
      return
    }
    if (winsAgainst[pick] === cpu) {
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
  }

  const displayMove = (move) => {
    if (!move) return '-'
    return move[0].toUpperCase() + move.slice(1)
  }

  const moveEmoji = (move) => {
    if (move === 'rock') return '✊'
    if (move === 'paper') return '✋'
    if (move === 'scissors') return '✌️'
    return '?'
  }

  const resultText = (() => {
    if (isResolving) return 'Thinking...'
    if (!round) return 'Choose Rock, Paper, or Scissors to start.'
    if (round.draw) return `Draw! Both picked ${displayMove(round.pick)}.`
    if (round.win) return `You Win! ${displayMove(round.pick)} beats ${displayMove(round.cpu)}.`
    return `You Lose! ${displayMove(round.cpu)} beats ${displayMove(round.pick)}.`
  })()

  return (
    <section className="rps-page">
      <header className="rps-header">
        <button className="rps-back-btn" onClick={() => navigate('/games')}>Back</button>
        <h1>Rock / Paper / Scissors</h1>
      </header>

      <div className="rps-board-wrap">
        <div className="rps-board">
          <div className="rps-vs-grid">
            <article className="rps-player-panel">
              <h3>You</h3>
              <div className="rps-token">{moveEmoji(round?.pick)}</div>
              <p>{`Picked: ${displayMove(round?.pick)}`}</p>
            </article>

            <div className="rps-vs-mark">VS</div>

            <article className="rps-player-panel">
              <h3>Computer</h3>
              <div className="rps-token">{moveEmoji(round?.cpu)}</div>
              <p>{`Result: ${displayMove(round?.cpu)}`}</p>
            </article>
          </div>

          <div className="rps-result-strip">{resultText}</div>
        </div>

        <div className="rps-actions">
          <button onClick={() => play('rock')} disabled={isResolving}>{isResolving ? '...' : 'Rock'}</button>
          <button onClick={() => play('paper')} disabled={isResolving}>{isResolving ? '...' : 'Paper'}</button>
          <button onClick={() => play('scissors')} disabled={isResolving}>{isResolving ? '...' : 'Scissors'}</button>
        </div>
        {isResolving && <div className="game-loading-inline" aria-live="polite"><span className="game-spinner" />Waiting for result...</div>}
      </div>
    </section>
  )
}

export default RpsGamePage
