import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getChatStats } from '../services/messagesApi'
import './MonthlyRecap.css'

const DISMISS_KEY_PREFIX = 'monthly_recap_dismissed_v1:'

function getMonthKey(value) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function getPreviousMonthLabel(value) {
  const previousMonth = new Date(value.getFullYear(), value.getMonth() - 1, 1)
  return previousMonth.toLocaleString(undefined, { month: 'long' })
}

function formatMonthKeyLabel(monthKey) {
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return ''
  const [year, month] = monthKey.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleString(undefined, { month: 'long' })
}

function MonthlyRecap({ token, peerUsername }) {
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [visible, setVisible] = useState(false)

  const now = useMemo(() => new Date(), [])
  const dismissKey = `${DISMISS_KEY_PREFIX}${getMonthKey(now)}`
  const titleMonthLabel = useMemo(() => getPreviousMonthLabel(now), [now])

  useEffect(() => {
    if (!token || !peerUsername) return
    if (now.getDate() !== 1) return

    try {
      if (window.localStorage.getItem(dismissKey)) return
    } catch {
      // Ignore localStorage read errors.
    }

    let cancelled = false
    const loadStats = async () => {
      try {
        const data = await getChatStats(token, peerUsername)
        if (cancelled || !data) return
        setStats(data)
        setVisible(true)
      } catch {
        // Keep chat usable if recap fetch fails.
      }
    }

    loadStats()
    return () => {
      cancelled = true
    }
  }, [dismissKey, now, peerUsername, token])

  const dismiss = () => {
    try {
      window.localStorage.setItem(dismissKey, '1')
    } catch {
      // Ignore localStorage write errors.
    }
    setVisible(false)
  }

  if (!visible || !stats) return null

  const recapLabel = formatMonthKeyLabel(stats?.recapMonth) || titleMonthLabel
  const messageCount = Number(stats?.recapMessages ?? stats?.thisMonthMessages ?? 0)
  const photoCount = Number(stats?.recapPhotos ?? stats?.thisMonthPhotos ?? 0)
  const voiceCount = Number(stats?.recapVoices ?? stats?.thisMonthVoices ?? 0)
  const talkedDays = Number(stats?.recapTalkDays ?? stats?.thisMonthTalkDays ?? 0)
  const daysInMonth = Number(stats?.recapDaysInMonth ?? stats?.daysInMonth ?? 0)

  return (
    <div className="monthly-recap-overlay" role="dialog" aria-modal="true" aria-label="Monthly recap">
      <div className="monthly-recap-card">
        <button type="button" className="monthly-recap-close" onClick={dismiss} aria-label="Close monthly recap">X</button>
        <h3 className="monthly-recap-title">{recapLabel} was beautiful</h3>
        <p className="monthly-recap-subtitle">A quick look at your chat moments.</p>
        <ul className="monthly-recap-list">
          <li><span>Messages sent</span><strong>{messageCount}</strong></li>
          <li><span>Photos shared</span><strong>{photoCount}</strong></li>
          <li><span>Voice notes</span><strong>{voiceCount}</strong></li>
          <li><span>Days talked</span><strong>{`${talkedDays}/${daysInMonth || talkedDays}`}</strong></li>
        </ul>
        <div className="monthly-recap-actions">
          <button type="button" className="monthly-recap-outline" onClick={dismiss}>Later</button>
          <button
            type="button"
            className="monthly-recap-btn"
            onClick={() => {
              dismiss()
              navigate(`/chat/recap?peer=${encodeURIComponent(peerUsername)}`)
            }}
          >
            View Full Recap
          </button>
        </div>
      </div>
    </div>
  )
}

export default MonthlyRecap
