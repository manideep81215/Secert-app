import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFlowState } from '../hooks/useFlowState'
import './SnakeLadderGamePage.css'

const DIFFICULTY_PRESETS = {
  easy: {
    label: 'Easy',
    ladders: [
      [3, 21],
      [8, 30],
      [28, 55],
      [36, 63],
      [51, 72],
      [71, 92],
    ],
    snakes: [
      [25, 5],
      [49, 29],
      [67, 47],
      [88, 66],
      [96, 76],
    ],
  },
  medium: {
    label: 'Medium',
    ladders: [
      [4, 14],
      [9, 31],
      [21, 42],
      [28, 50],
      [40, 61],
      [63, 84],
    ],
    snakes: [
      [19, 7],
      [35, 16],
      [48, 27],
      [66, 45],
      [79, 58],
      [93, 73],
      [98, 79],
    ],
  },
  hard: {
    label: 'Hard',
    ladders: [
      [2, 12],
      [11, 26],
      [22, 40],
      [45, 64],
      [70, 88],
    ],
    snakes: [
      [17, 4],
      [31, 10],
      [43, 21],
      [57, 36],
      [69, 49],
      [78, 54],
      [87, 60],
      [95, 72],
      [99, 80],
    ],
  },
}

const BOARD_ROWS = Array.from({ length: 10 }, (_, rowFromTop) => {
  const rowFromBottom = 9 - rowFromTop
  const start = rowFromBottom * 10 + 1
  const values = Array.from({ length: 10 }, (_, col) => start + col)
  return rowFromBottom % 2 === 0 ? values : [...values].reverse()
})

const DIFFICULTY_KEYS = ['easy', 'medium', 'hard']

function randomDice() {
  return Math.floor(Math.random() * 6) + 1
}

function toCellPoint(cell) {
  const index = cell - 1
  const rowFromBottom = Math.floor(index / 10)
  const inRow = index % 10
  const col = rowFromBottom % 2 === 0 ? inRow : 9 - inRow
  const x = (col + 0.5) * 10
  const y = (9 - rowFromBottom + 0.5) * 10
  return { x, y }
}

function SnakeLadderGamePage() {
  const navigate = useNavigate()
  const [flow, setFlow] = useFlowState()
  const [difficulty, setDifficulty] = useState('medium')
  const [positions, setPositions] = useState({ you: 1, cpu: 1 })
  const [turn, setTurn] = useState('you')
  const [diceValue, setDiceValue] = useState(null)
  const [status, setStatus] = useState('Pick difficulty and roll the dice.')
  const [winner, setWinner] = useState('')
  const [isRolling, setIsRolling] = useState(false)
  const cpuTimerRef = useRef(null)
  const rollTimerRef = useRef(null)

  useEffect(() => {
    if (!flow.username || !flow.token) navigate('/auth')
  }, [flow.username, flow.token, navigate])

  useEffect(() => () => {
    if (cpuTimerRef.current) {
      clearTimeout(cpuTimerRef.current)
      cpuTimerRef.current = null
    }
    if (rollTimerRef.current) {
      clearTimeout(rollTimerRef.current)
      rollTimerRef.current = null
    }
  }, [])

  const preset = DIFFICULTY_PRESETS[difficulty]
  const jumpMap = useMemo(() => {
    const map = {}
    for (const [from, to] of preset.ladders) map[from] = to
    for (const [from, to] of preset.snakes) map[from] = to
    return map
  }, [preset])

  const resetGame = (nextDifficulty = difficulty) => {
    if (cpuTimerRef.current) {
      clearTimeout(cpuTimerRef.current)
      cpuTimerRef.current = null
    }
    if (rollTimerRef.current) {
      clearTimeout(rollTimerRef.current)
      rollTimerRef.current = null
    }
    setDifficulty(nextDifficulty)
    setPositions({ you: 1, cpu: 1 })
    setTurn('you')
    setDiceValue(null)
    setWinner('')
    setIsRolling(false)
    setStatus(`Difficulty: ${DIFFICULTY_PRESETS[nextDifficulty].label}. Your turn, roll the dice.`)
  }

  const unlock = () => {
    if (flow.unlocked) return
    setFlow((prev) => ({ ...prev, unlocked: true }))
  }

  const applyMove = (playerKey, roll) => {
    const current = positions[playerKey]
    const moved = current + roll
    let landing = moved > 100 ? current : moved

    if (jumpMap[landing]) {
      const target = jumpMap[landing]
      const isLadder = target > landing
      setStatus(`${playerKey === 'you' ? 'You' : 'Computer'} rolled ${roll}. ${isLadder ? 'Ladder up!' : 'Snake bite!'} ${landing} to ${target}.`)
      landing = target
    } else {
      setStatus(`${playerKey === 'you' ? 'You' : 'Computer'} rolled ${roll}. Moved to ${landing}.`)
    }

    const nextPositions = { ...positions, [playerKey]: landing }
    setPositions(nextPositions)
    return landing
  }

  const runTurn = (playerKey) => {
    if (winner) return
    setIsRolling(true)
    const roll = randomDice()
    setDiceValue(roll)

    rollTimerRef.current = setTimeout(() => {
      const finalCell = applyMove(playerKey, roll)
      setIsRolling(false)
      if (finalCell === 100) {
        const who = playerKey === 'you' ? 'You' : 'Computer'
        setWinner(playerKey)
        setStatus(`${who} won the game.`)
        if (playerKey === 'you') unlock()
        return
      }
      setTurn(playerKey === 'you' ? 'cpu' : 'you')
      rollTimerRef.current = null
    }, 300)
  }

  useEffect(() => {
    if (winner || turn !== 'cpu') return
    cpuTimerRef.current = setTimeout(() => {
      runTurn('cpu')
      cpuTimerRef.current = null
    }, 900)
    return () => {
      if (cpuTimerRef.current) {
        clearTimeout(cpuTimerRef.current)
        cpuTimerRef.current = null
      }
    }
  }, [turn, winner, positions, difficulty])

  const onRoll = () => {
    if (winner || turn !== 'you' || isRolling) return
    runTurn('you')
  }

  return (
    <section className="snake-page">
      <header className="snake-header">
        <button className="snake-back-btn" onClick={() => navigate('/games')}>Back</button>
        <h1>Snake & Ladders</h1>
      </header>

      <div className="snake-card">
        <div className="snake-toolbar">
          <div className="snake-difficulty-menu" role="group" aria-label="Difficulty options">
            {DIFFICULTY_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className={`snake-difficulty-btn ${difficulty === key ? 'active' : ''}`}
                onClick={() => resetGame(key)}
              >
                {DIFFICULTY_PRESETS[key].label}
              </button>
            ))}
          </div>

          <button type="button" className="snake-reset-btn" onClick={() => resetGame()}>
            Restart
          </button>
        </div>

        <div className="snake-board-wrap">
          <div className="snake-board">
            <svg className="snake-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {preset.ladders.map(([from, to]) => {
                const a = toCellPoint(from)
                const b = toCellPoint(to)
                const rungCount = 5
                const rungPoints = Array.from({ length: rungCount }, (_, idx) => {
                  const t = (idx + 1) / (rungCount + 1)
                  return {
                    x: a.x + (b.x - a.x) * t,
                    y: a.y + (b.y - a.y) * t,
                  }
                })
                return (
                  <g key={`ladder-${from}-${to}`} className="ladder-line">
                    <line className="ladder-rail" x1={a.x - 1.1} y1={a.y} x2={b.x - 1.1} y2={b.y} />
                    <line className="ladder-rail" x1={a.x + 1.1} y1={a.y} x2={b.x + 1.1} y2={b.y} />
                    {rungPoints.map((point, idx) => (
                      <line
                        key={`rung-${from}-${to}-${idx}`}
                        className="ladder-rung"
                        x1={point.x - 1.05}
                        y1={point.y}
                        x2={point.x + 1.05}
                        y2={point.y}
                      />
                    ))}
                  </g>
                )
              })}
              {preset.snakes.map(([from, to]) => {
                const a = toCellPoint(from)
                const b = toCellPoint(to)
                const cx = (a.x + b.x) / 2 + (a.x > b.x ? -5 : 5)
                return (
                  <path
                    key={`snake-${from}-${to}`}
                    className="snake-line"
                    d={`M ${a.x} ${a.y} Q ${cx} ${(a.y + b.y) / 2} ${b.x} ${b.y}`}
                  />
                )
              })}
            </svg>

            <div className="snake-grid">
              {BOARD_ROWS.flat().map((cell) => (
                <div key={cell} className="snake-cell">
                  <span className="snake-cell-number">{cell}</span>
                  {positions.you === cell && <span className="snake-token snake-token-you">Y</span>}
                  {positions.cpu === cell && <span className="snake-token snake-token-cpu">C</span>}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="snake-controls">
          <div className="snake-dice-face">{diceValue || '?'}</div>
          <button className="snake-roll-btn" onClick={onRoll} disabled={turn !== 'you' || !!winner || isRolling}>
            {isRolling ? 'Rolling...' : 'Roll'}
          </button>
        </div>

        <div className="snake-status" role="status" aria-live="polite">
          <p>{winner ? `${winner === 'you' ? 'You' : 'Computer'} reached 100.` : status}</p>
          <p className="snake-turn">{winner ? 'Game over' : turn === 'you' ? 'Your Turn' : 'Computer Turn'}</p>
        </div>
      </div>
    </section>
  )
}

export default SnakeLadderGamePage
