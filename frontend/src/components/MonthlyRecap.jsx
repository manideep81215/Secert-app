import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getChatStats } from '../services/messagesApi'
import './MonthlyRecap.css'

const DISMISS_KEY_PREFIX = 'monthly_recap_dismissed_v1:'
const CLOSE_ANIMATION_MS = 380

function getMonthKey(value) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function formatRecapMonthLabel(monthKey, fallbackDate) {
  if (monthKey && /^\d{4}-\d{2}$/.test(monthKey)) {
    const [year, month] = monthKey.split('-').map(Number)
    return new Date(year, month - 1, 1).toLocaleString(undefined, { month: 'long' })
  }

  const previousMonth = new Date(fallbackDate.getFullYear(), fallbackDate.getMonth() - 1, 1)
  return previousMonth.toLocaleString(undefined, { month: 'long' })
}

function StatRow({ emoji, label, value, delay, color }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), delay)
    return () => window.clearTimeout(timer)
  }, [delay])

  return (
    <div className={`mr-stat-row ${visible ? 'mr-stat-visible' : ''}`}>
      <div className="mr-stat-left">
        <span className="mr-stat-emoji" aria-hidden="true">{emoji}</span>
        <span className="mr-stat-label">{label}</span>
      </div>
      <div className="mr-stat-value" style={{ color }}>{Number(value || 0).toLocaleString()}</div>
    </div>
  )
}

function MonthlyRecap({ token, peerUsername, forceShow = false }) {
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [show, setShow] = useState(false)
  const [visible, setVisible] = useState(false)

  const now = useMemo(() => new Date(), [])
  const dismissKey = `${DISMISS_KEY_PREFIX}${getMonthKey(now)}`

  useEffect(() => {
    if (!token || !peerUsername) return

    const isRecapDay = now.getDate() === 13
    if (!isRecapDay && !forceShow) return

    try {
      if (!forceShow && window.localStorage.getItem(dismissKey) === '1') return
    } catch {
      // Ignore localStorage read failures.
    }

    let cancelled = false

    const loadStats = async () => {
      try {
        const data = await getChatStats(token, peerUsername)
        if (cancelled || !data) return
        setStats(data)
        setShow(true)
        window.setTimeout(() => {
          if (!cancelled) setVisible(true)
        }, 80)
      } catch {
        // Keep chat usable if recap loading fails.
      }
    }

    loadStats()
    return () => {
      cancelled = true
    }
  }, [dismissKey, forceShow, now, peerUsername, token])

  const closeSheet = (persistDismiss) => {
    if (persistDismiss) {
      try {
        window.localStorage.setItem(dismissKey, '1')
      } catch {
        // Ignore localStorage write failures.
      }
    }

    setVisible(false)
    window.setTimeout(() => setShow(false), CLOSE_ANIMATION_MS)
  }

  if (!show || !stats) return null

  const monthLabel = formatRecapMonthLabel(stats?.recapMonth, now)
  const recapMessages = Number(stats?.recapMessages || 0)
  const recapPhotos = Number(stats?.recapPhotos || 0)
  const recapVideos = Number(stats?.recapVideos || 0)
  const recapVoices = Number(stats?.recapVoices || 0)
  const recapTalkDays = Number(stats?.recapTalkDays || 0)
  const recapDaysInMonth = Math.max(1, Number(stats?.recapDaysInMonth || 1))
  const longestStreak = Number(stats?.longestStreak || 0)

  return (
    <div className="mr-overlay" role="dialog" aria-modal="true" aria-label="Monthly recap">
      <div className={`mr-sheet ${visible ? 'mr-sheet-visible' : ''}`}>
        <div className="mr-header">
          <div className="mr-header-bg" />
          <div className="mr-handle" />
          <div className="mr-month-label">Monthly Recap</div>
          <div className="mr-title"><span>{monthLabel}</span> was beautiful</div>
          <div className="mr-subtitle">Here is your story in numbers</div>
        </div>

        <div className="mr-divider" />

        <div className="mr-stats">
          <div className="mr-section-label">Last Month</div>
          <StatRow emoji={'\uD83D\uDCAC'} label="Messages sent" value={recapMessages} delay={120} color="#ff8fab" />
          <StatRow emoji={'\uD83D\uDCF8'} label="Photos shared" value={recapPhotos} delay={200} color="#c084fc" />
          <StatRow emoji={'\uD83C\uDFAC'} label="Videos shared" value={recapVideos} delay={280} color="#60a5fa" />
          <StatRow emoji={'\uD83C\uDFA4'} label="Voice notes" value={recapVoices} delay={360} color="#34d399" />
        </div>

        <div className="mr-streak-banner">
          <div className="mr-streak-icon" aria-hidden="true">{'\uD83D\uDD25'}</div>
          <div className="mr-streak-text">
            <div className="mr-streak-title">{`${recapTalkDays}/${recapDaysInMonth} days talked in ${monthLabel}`}</div>
            <div className="mr-streak-sub">Longest streak ever: {longestStreak} days</div>
          </div>
        </div>

        <div className="mr-actions">
          <button
            type="button"
            className="mr-btn-full"
            onClick={() => {
              closeSheet(true)
              navigate(`/chat/recap?peer=${encodeURIComponent(peerUsername)}`)
            }}
          >
            View Full Recap
          </button>
          <button type="button" className="mr-btn-dismiss" onClick={() => closeSheet(true)}>
            So sweet
          </button>
        </div>
      </div>
    </div>
  )
}

export default MonthlyRecap
