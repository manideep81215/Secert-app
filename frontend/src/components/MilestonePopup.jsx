import { useEffect, useState } from 'react'
import { getChatStats } from '../services/messagesApi'
import './MilestonePopup.css'

const MESSAGE_MILESTONES = [
  { count: 100, emoji: '\uD83D\uDCAC', title: '100 Messages!', color: '#60a5fa', glow: 'rgba(96,165,250,0.45)', message: '100 messages in. Every single one brought you closer.' },
  { count: 500, emoji: '\uD83D\uDC8C', title: '500 Messages!', color: '#c084fc', glow: 'rgba(192,132,252,0.45)', message: '500 messages between you two. That is 500 moments of love.' },
  { count: 1000, emoji: '\uD83C\uDF89', title: '1,000 Messages!', color: '#ff8fab', glow: 'rgba(255,107,157,0.55)', message: '1,000 messages. A thousand little pieces of your love story.' },
  { count: 2000, emoji: '\uD83D\uDC95', title: '2,000 Messages!', color: '#f472b6', glow: 'rgba(244,114,182,0.45)', message: 'Two thousand messages. You never run out of things to say.' },
  { count: 5000, emoji: '\uD83E\uDD79', title: '5,000 Messages!', color: '#fb923c', glow: 'rgba(251,146,60,0.45)', message: 'Five thousand. This chat is pure commitment.' },
  { count: 10000, emoji: '\u2764\uFE0F', title: '10,000 Messages!', color: '#ef4444', glow: 'rgba(239,68,68,0.52)', message: 'Ten thousand messages. This is what forever looks like.' },
]

const STREAK_MILESTONES = [
  { days: 7, emoji: '\uD83D\uDD25', title: '7 Days Straight!', color: '#fb923c', glow: 'rgba(251,146,60,0.45)', message: 'One whole week of talking every single day.' },
  { days: 30, emoji: '\uD83D\uDD25', title: '30 Days Straight!', color: '#f97316', glow: 'rgba(249,115,22,0.5)', message: '30 days straight. A full month without missing a day.' },
  { days: 100, emoji: '\uD83D\uDCAA', title: '100 Days Straight!', color: '#ff8fab', glow: 'rgba(255,107,157,0.55)', message: '100 days of talking every day. This is a lifestyle.' },
  { days: 365, emoji: '\uD83E\uDD79', title: '365 Days Straight!', color: '#c084fc', glow: 'rgba(192,132,252,0.55)', message: 'A whole year of daily talks. Every single day.' },
]

const CLOSE_ANIMATION_MS = 420

function buildCelebrationKey(kind, value) {
  return `milestone_celebrated_v1:${kind}:${value}`
}

function wasAlreadyCelebrated(kind, value) {
  const scoped = buildCelebrationKey(kind, value)
  const legacy = kind === 'msg' ? `milestone_celebrated_v1:${value}` : `streak_celebrated_v1:${value}`
  return window.localStorage.getItem(scoped) === '1' || window.localStorage.getItem(legacy) === '1'
}

function markCelebrated(kind, value) {
  window.localStorage.setItem(buildCelebrationKey(kind, value), '1')
}

function createParticles(color) {
  return Array.from({ length: 18 }, (_, index) => {
    const tx = ((Math.random() * 2) - 1).toFixed(3)
    const ty = (Math.random() + 0.2).toFixed(3)

    return {
      id: `${index}-${Date.now()}`,
      left: `${10 + Math.random() * 80}%`,
      top: `${8 + Math.random() * 60}%`,
      width: `${3 + Math.random() * 5}px`,
      height: `${3 + Math.random() * 5}px`,
      background: index % 3 === 0 ? color : index % 3 === 1 ? '#ffffff' : '#ffd700',
      borderRadius: index % 2 === 0 ? '50%' : '2px',
      animationDelay: `${Math.random() * 0.45}s`,
      animationDuration: `${0.85 + Math.random() * 0.75}s`,
      opacity: 0.65 + Math.random() * 0.35,
      tx,
      ty,
    }
  })
}

function resolveNextStreakMilestone(currentStreak) {
  for (const streak of [...STREAK_MILESTONES].reverse()) {
    if (currentStreak >= streak.days) {
      if (!wasAlreadyCelebrated('streak', streak.days)) {
        return { ...streak, kind: 'streak' }
      }
      break
    }
  }
  return null
}

function MilestonePopup({ token, peerUsername, triggerCheck }) {
  const [milestone, setMilestone] = useState(null)
  const [visible, setVisible] = useState(false)
  const [particles, setParticles] = useState([])

  useEffect(() => {
    if (!token || !peerUsername || !triggerCheck) return

    let cancelled = false

    const loadAndCheck = async () => {
      try {
        const stats = await getChatStats(token, peerUsername)
        if (cancelled || !stats) return

        const reachedMilestone = Number(stats?.milestoneReached || 0)
        const milestoneJustHit = Boolean(stats?.milestoneJustHit)
        if (milestoneJustHit && reachedMilestone > 0 && !wasAlreadyCelebrated('msg', reachedMilestone)) {
          const messageMilestone = MESSAGE_MILESTONES.find((row) => row.count === reachedMilestone)
          if (messageMilestone) {
            setMilestone({ ...messageMilestone, kind: 'messages' })
            setParticles(createParticles(messageMilestone.color))
            window.setTimeout(() => {
              if (!cancelled) setVisible(true)
            }, 80)
            return
          }
        }

        const currentStreak = Number(stats?.daysTrackedStreak || 0)
        const streakMilestone = resolveNextStreakMilestone(currentStreak)
        if (!streakMilestone) return

        setMilestone(streakMilestone)
        setParticles(createParticles(streakMilestone.color))
        window.setTimeout(() => {
          if (!cancelled) setVisible(true)
        }, 80)
      } catch {
        // Ignore milestone failures to avoid interrupting chat flow.
      }
    }

    loadAndCheck()
    return () => {
      cancelled = true
    }
  }, [peerUsername, token, triggerCheck])

  const dismiss = () => {
    if (!milestone) return

    const keyValue = milestone.kind === 'messages' ? milestone.count : milestone.days
    markCelebrated(milestone.kind === 'messages' ? 'msg' : 'streak', keyValue)

    setVisible(false)
    window.setTimeout(() => {
      setMilestone(null)
      setParticles([])
    }, CLOSE_ANIMATION_MS)
  }

  if (!milestone) return null

  return (
    <div className="ms-overlay" role="dialog" aria-modal="true" aria-label="Milestone reached">
      <div className={`ms-card ${visible ? 'ms-visible' : ''}`}>
        <div className="ms-card-bg" />
        <div
          className="ms-card-glow"
          style={{
            background: `radial-gradient(ellipse at 50% 0%, ${milestone.glow} 0%, transparent 60%)`,
            boxShadow: `0 0 60px ${milestone.glow}, inset 0 0 52px ${milestone.glow}`,
          }}
        />

        <div className="ms-rings" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <div
              key={`${milestone.title}-ring-${index}`}
              className="ms-ring"
              style={{ borderColor: milestone.color, animationDelay: `${index * 0.2}s` }}
            />
          ))}
        </div>

        {particles.map((particle) => (
          <div
            key={particle.id}
            className="ms-particle"
            style={{
              left: particle.left,
              top: particle.top,
              width: particle.width,
              height: particle.height,
              background: particle.background,
              borderRadius: particle.borderRadius,
              animationDelay: particle.animationDelay,
              animationDuration: particle.animationDuration,
              opacity: particle.opacity,
              '--tx': particle.tx,
              '--ty': particle.ty,
            }}
          />
        ))}

        <span className="ms-emoji" aria-hidden="true">{milestone.emoji}</span>

        <div className="ms-title" style={{ color: milestone.color }}>{milestone.title}</div>

        <div className="ms-counter">
          <span className="ms-counter-num" style={{ color: milestone.color }}>
            {milestone.kind === 'messages' ? Number(milestone.count).toLocaleString() : Number(milestone.days)}
          </span>
          <span className="ms-counter-label">{milestone.kind === 'messages' ? 'messages' : 'day streak'}</span>
        </div>

        <div className="ms-message">{milestone.message}</div>

        <button
          type="button"
          className="ms-btn"
          style={{
            background: `linear-gradient(135deg, ${milestone.color}, ${milestone.color}cc)`,
            boxShadow: `0 6px 20px ${milestone.glow}`,
          }}
          onClick={dismiss}
        >
          {`Let's keep going \uD83D\uDC95`}
        </button>
      </div>
    </div>
  )
}

export default MilestonePopup
