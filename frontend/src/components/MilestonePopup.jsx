import { useEffect, useState } from 'react'
import { getChatStats } from '../services/messagesApi'
import './MilestonePopup.css'

const MESSAGE_MILESTONE_THEMES = [
  { emoji: '\uD83D\uDC8C', color: '#60a5fa', glow: 'rgba(96,165,250,0.45)' },
  { emoji: '\uD83C\uDF89', color: '#c084fc', glow: 'rgba(192,132,252,0.45)' },
  { emoji: '\uD83D\uDC95', color: '#ff8fab', glow: 'rgba(255,107,157,0.55)' },
  { emoji: '\uD83E\uDD79', color: '#f472b6', glow: 'rgba(244,114,182,0.45)' },
  { emoji: '\uD83D\uDE0D', color: '#fb923c', glow: 'rgba(251,146,60,0.45)' },
  { emoji: '\u2764\uFE0F', color: '#ef4444', glow: 'rgba(239,68,68,0.52)' },
]

const GLOBAL_MILESTONE_TARGET = 4000

const GLOBAL_4000_MILESTONE = {
  kind: 'global',
  count: GLOBAL_MILESTONE_TARGET,
  emoji: '\u2705',
  color: '#22c55e',
  glow: 'rgba(34,197,94,0.55)',
  title: '4,000 Messages Reached!',
  message: 'All users together reached 4,000 chat messages.',
  buttonText: 'Amazing \u2705',
  isSpecial: true,
}

function buildSpecialLoveMilestone(count) {
  return {
    kind: 'messages',
    count,
    emoji: '\uD83D\uDC9D',
    color: '#ff1493',
    glow: 'rgba(255,20,147,0.6)',
    title: `${count} Messages of Love!`,
    message: `Through ${count} conversations, your love story continues to bloom. Here's to forever together. \uD83D\uDC91`,
    buttonText: 'Forever & Always \uD83D\uDC96',
    isSpecial: true,
  }
}

const SPECIAL_MESSAGE_MILESTONES = {
  9192: buildSpecialLoveMilestone(9192),
  9291: buildSpecialLoveMilestone(9291),
}

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

function createParticles(color, isSpecial = false) {
  const particleCount = isSpecial ? 30 : 18
  return Array.from({ length: particleCount }, (_, index) => {
    const tx = ((Math.random() * 2) - 1).toFixed(3)
    const ty = (Math.random() + 0.2).toFixed(3)

    return {
      id: `${index}-${Date.now()}`,
      left: `${10 + Math.random() * 80}%`,
      top: `${8 + Math.random() * 60}%`,
      width: `${3 + Math.random() * (isSpecial ? 8 : 5)}px`,
      height: `${3 + Math.random() * (isSpecial ? 8 : 5)}px`,
      background: isSpecial
        ? (index % 4 === 0 ? color : index % 4 === 1 ? '#ff69b4' : index % 4 === 2 ? '#ffd700' : '#ffffff')
        : (index % 3 === 0 ? color : index % 3 === 1 ? '#ffffff' : '#ffd700'),
      borderRadius: index % 2 === 0 ? '50%' : '2px',
      animationDelay: `${Math.random() * 0.45}s`,
      animationDuration: `${0.85 + Math.random() * 0.75}s`,
      opacity: 0.65 + Math.random() * 0.35,
      tx,
      ty,
    }
  })
}

function getSpecialMessageMilestone(count) {
  return SPECIAL_MESSAGE_MILESTONES[Number(count || 0)] || null
}

function buildMessageMilestone(count) {
  const specialMilestone = getSpecialMessageMilestone(count)
  if (specialMilestone) {
    return specialMilestone
  }

  const safeCount = Math.max(500, Number(count || 0))
  const tierIndex = Math.max(0, Math.floor(safeCount / 500) - 1)
  const theme = MESSAGE_MILESTONE_THEMES[tierIndex % MESSAGE_MILESTONE_THEMES.length]
  return {
    kind: 'messages',
    count: safeCount,
    emoji: theme.emoji,
    color: theme.color,
    glow: theme.glow,
    title: `${safeCount.toLocaleString()} Messages!`,
    message: `${safeCount.toLocaleString()} messages and your story keeps growing.`,
    buttonText: 'Let\'s keep going \uD83D\uDC95',
    isSpecial: false,
  }
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
    if (!token || !peerUsername) return

    let cancelled = false

    const loadAndCheck = async () => {
      try {
        const stats = await getChatStats(token, peerUsername, { trackMilestone: true })
        if (cancelled || !stats) return

        const globalTotalMessages = Number(stats?.globalTotalMessages || 0)
        if (globalTotalMessages >= GLOBAL_MILESTONE_TARGET && !wasAlreadyCelebrated('global_msg', GLOBAL_MILESTONE_TARGET)) {
          setMilestone(GLOBAL_4000_MILESTONE)
          setParticles(createParticles(GLOBAL_4000_MILESTONE.color, true))
          window.setTimeout(() => {
            if (!cancelled) setVisible(true)
          }, 80)
          return
        }

        const exactTotalMessages = Number(stats?.totalMessages || 0)
        const exactSpecialMilestone = getSpecialMessageMilestone(exactTotalMessages)
        if (exactSpecialMilestone && !wasAlreadyCelebrated('msg', exactTotalMessages)) {
          setMilestone(exactSpecialMilestone)
          setParticles(createParticles(exactSpecialMilestone.color, true))
          window.setTimeout(() => {
            if (!cancelled) setVisible(true)
          }, 80)
          return
        }

        const reachedMilestone = Number(stats?.milestoneReached || 0)
        const milestoneJustHit = Boolean(stats?.milestoneJustHit)

        if (milestoneJustHit && reachedMilestone > 0 && !wasAlreadyCelebrated('msg', reachedMilestone)) {
          const messageMilestone = buildMessageMilestone(reachedMilestone)
          setMilestone(messageMilestone)
          setParticles(createParticles(messageMilestone.color, messageMilestone.isSpecial))
          window.setTimeout(() => {
            if (!cancelled) setVisible(true)
          }, 80)
          return
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

    let markKind = 'msg'
    let keyValue = milestone.count
    if (milestone.kind === 'streak') {
      markKind = 'streak'
      keyValue = milestone.days
    } else if (milestone.kind === 'global') {
      markKind = 'global_msg'
      keyValue = GLOBAL_MILESTONE_TARGET
    }
    markCelebrated(markKind, keyValue)

    setVisible(false)
    window.setTimeout(() => {
      setMilestone(null)
      setParticles([])
    }, CLOSE_ANIMATION_MS)
  }

  if (!milestone) return null

  return (
    <div className="ms-overlay" role="dialog" aria-modal="true" aria-label="Milestone reached">
      <div className={`ms-card ${visible ? 'ms-visible' : ''} ${milestone.isSpecial ? 'ms-special' : ''}`}>
        <div className="ms-card-bg" />
        <div
          className="ms-card-glow"
          style={{
            background: `radial-gradient(ellipse at 50% 0%, ${milestone.glow} 0%, transparent 60%)`,
            boxShadow: `0 0 ${milestone.isSpecial ? '80px' : '60px'} ${milestone.glow}, inset 0 0 ${milestone.isSpecial ? '60px' : '52px'} ${milestone.glow}`,
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

        <span className={`ms-emoji ${milestone.isSpecial ? 'ms-emoji-special' : ''}`} aria-hidden="true">
          {milestone.emoji}
        </span>

        <div className="ms-title" style={{ color: milestone.color }}>{milestone.title}</div>

        <div className="ms-counter">
          <span className="ms-counter-num" style={{ color: milestone.color }}>
            {milestone.kind === 'streak' ? Number(milestone.days) : Number(milestone.count).toLocaleString()}
          </span>
          <span className="ms-counter-label">
            {milestone.kind === 'streak' ? 'day streak' : 'messages'}
          </span>
        </div>

        <div className={`ms-message ${milestone.isSpecial ? 'ms-message-special' : ''}`}>
          {milestone.message}
        </div>

        <button
          type="button"
          className={`ms-btn ${milestone.isSpecial ? 'ms-btn-special' : ''}`}
          style={{
            background: milestone.isSpecial
              ? `linear-gradient(135deg, ${milestone.color}, #ff69b4, ${milestone.color})`
              : `linear-gradient(135deg, ${milestone.color}, ${milestone.color}cc)`,
            boxShadow: `0 6px 20px ${milestone.glow}`,
          }}
          onClick={dismiss}
        >
          {milestone.buttonText || 'Let\'s keep going \uD83D\uDC95'}
        </button>
      </div>
    </div>
  )
}

export default MilestonePopup
