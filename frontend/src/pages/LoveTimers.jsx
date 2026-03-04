import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './LoveTimers.css'

const FIRST_TALK = new Date('2022-11-28T00:00:00')
const TALKING_START = new Date('2025-03-11T00:00:00')
const LOVE_START = new Date('2025-10-07T00:00:00')
const LOVE_TIMERS_SECRET_CODE = String(import.meta.env.VITE_LOVE_TIMERS_SECRET_CODE || '9192').trim()

function getElapsed(since) {
  const now = new Date()
  const diff = now - since

  const totalSeconds = Math.floor(diff / 1000)
  const totalMinutes = Math.floor(totalSeconds / 60)
  const totalHours = Math.floor(totalMinutes / 60)
  const totalDays = Math.floor(totalHours / 24)
  const totalYears = Math.floor(totalDays / 365.25)

  const years = totalYears
  const months = Math.floor((totalDays - (years * 365.25)) / 30.4375)
  const days = Math.floor(totalDays - (years * 365.25) - (months * 30.4375))
  const hours = totalHours % 24
  const minutes = totalMinutes % 60
  const seconds = totalSeconds % 60

  return { years, months, days, hours, minutes, seconds, totalDays }
}

function FloatingHeart({ style }) {
  return (
    <div className="float-heart" style={style}>
      {'\uD83D\uDC95'}
    </div>
  )
}

function TimerUnit({ value, label }) {
  const [prev, setPrev] = useState(value)
  const [flip, setFlip] = useState(false)

  useEffect(() => {
    if (value === prev) return undefined
    setFlip(true)
    const timeoutId = window.setTimeout(() => {
      setPrev(value)
      setFlip(false)
    }, 300)
    return () => window.clearTimeout(timeoutId)
  }, [value, prev])

  return (
    <div className="timer-unit">
      <div className={`timer-value ${flip ? 'flip' : ''}`}>
        <span>{String(value).padStart(2, '0')}</span>
      </div>
      <div className="timer-label">{label}</div>
    </div>
  )
}

function TimerCard({ title, subtitle, icon, since, accentColor, glowColor, delay }) {
  const [elapsed, setElapsed] = useState(() => getElapsed(since))
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const visibleTimeout = window.setTimeout(() => setVisible(true), delay)
    const intervalId = window.setInterval(() => {
      setElapsed(getElapsed(since))
    }, 1000)
    return () => {
      window.clearTimeout(visibleTimeout)
      window.clearInterval(intervalId)
    }
  }, [since, delay])

  return (
    <div
      className={`timer-card ${visible ? 'visible' : ''}`}
      style={{
        '--accent': accentColor,
        '--glow': glowColor,
      }}
    >
      <div className="card-shimmer" />
      <div className="card-icon">{icon}</div>
      <div className="card-title">{title}</div>
      <div className="card-subtitle">{subtitle}</div>

      <div className="card-days">
        <span className="days-number">{elapsed.totalDays.toLocaleString()}</span>
        <span className="days-word">days</span>
      </div>

      <div className="timer-grid">
        {elapsed.years > 0 && <TimerUnit value={elapsed.years} label="years" />}
        {elapsed.months > 0 && <TimerUnit value={elapsed.months} label="months" />}
        <TimerUnit value={elapsed.days} label="days" />
        <TimerUnit value={elapsed.hours} label="hours" />
        <TimerUnit value={elapsed.minutes} label="mins" />
        <TimerUnit value={elapsed.seconds} label="secs" />
      </div>

      <div className="card-footer">
        Since {since.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
      </div>
    </div>
  )
}

function LoveTimers() {
  const navigate = useNavigate()
  const [enteredCode, setEnteredCode] = useState('')
  const [isUnlocked, setIsUnlocked] = useState(false)
  const [codeError, setCodeError] = useState('')
  const hearts = useMemo(() => (
    Array.from({ length: 12 }, () => ({
      left: `${Math.random() * 100}%`,
      animationDelay: `${Math.random() * 8}s`,
      animationDuration: `${6 + (Math.random() * 6)}s`,
      fontSize: `${0.8 + (Math.random() * 1.2)}rem`,
      opacity: 0.15 + (Math.random() * 0.25),
    }))
  ), [])
  const handleUnlock = (event) => {
    event.preventDefault()
    const normalized = String(enteredCode || '').trim()
    if (!normalized) {
      setCodeError('Enter secret code.')
      return
    }
    if (normalized !== LOVE_TIMERS_SECRET_CODE) {
      setCodeError('Invalid secret code.')
      return
    }
    setCodeError('')
    setIsUnlocked(true)
  }

  return (
    <div className="love-page">
      <button className="love-back-btn" type="button" onClick={() => navigate('/chat')}>
        {'\u2190'} Back
      </button>
      <div className="love-wrap">
        {hearts.map((heart, index) => (
          <FloatingHeart
            key={`heart-${index}`}
            style={{
              left: heart.left,
              animationDelay: heart.animationDelay,
              animationDuration: heart.animationDuration,
              fontSize: heart.fontSize,
              opacity: heart.opacity,
            }}
          />
        ))}

        {!isUnlocked ? (
          <div className="timer-secret-wrap">
            <div className="timer-secret-title">Enter Secret Code</div>
            <p className="timer-secret-subtitle">Verification required to open love timers.</p>
            <form className="timer-secret-form" onSubmit={handleUnlock}>
              <input
                className="timer-secret-input"
                type="password"
                value={enteredCode}
                onChange={(event) => {
                  setEnteredCode(event.target.value)
                  if (codeError) setCodeError('')
                }}
                placeholder="Secret code"
                autoComplete="off"
              />
              <button className="timer-secret-btn" type="submit">Unlock</button>
            </form>
            {codeError ? <p className="timer-secret-error">{codeError}</p> : null}
          </div>
        ) : (
          <>
            <div className="love-header">
              <h1>Our <span>Story</span></h1>
              <p>every second counts {'\uD83D\uDC95'}</p>
            </div>

            <div className="cards-wrap">
              <TimerCard
                title="First Hello"
                subtitle="The very first time we talked"
                icon={'\uD83D\uDCAC'}
                since={FIRST_TALK}
                accentColor="#c084fc"
                glowColor="rgba(192, 132, 252, 0.6)"
                delay={200}
              />
              <TimerCard
                title="Found Again"
                subtitle="When we came back to each other"
                icon={'\uD83D\uDD01'}
                since={TALKING_START}
                accentColor="#ff8fab"
                glowColor="rgba(255, 107, 157, 0.6)"
                delay={500}
              />
              <TimerCard
                title="In Love"
                subtitle="When we said I love you"
                icon={'\u2764\uFE0F'}
                since={LOVE_START}
                accentColor="#ff6b9d"
                glowColor="rgba(200, 60, 120, 0.6)"
                delay={800}
              />
            </div>

            <div className="love-footer">
              <p>"hello {'\u2192'} apart {'\u2192'} together {'\u2192'} forever {'\uD83D\uDC95'}"</p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default LoveTimers
