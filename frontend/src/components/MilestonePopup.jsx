import { useEffect, useState } from 'react'
import { getChatStats } from '../services/messagesApi'
import './MilestonePopup.css'

const MESSAGE_MILESTONES = [100, 500, 1000, 2000, 5000, 10000]
const STREAK_MESSAGES = {
  7: 'One week of talking every day.',
  30: '30 days straight.',
  100: '100 days. Unbreakable.',
  365: 'A whole year of daily talks.',
}

function MilestonePopup({ token, peerUsername, triggerCheck }) {
  const [popup, setPopup] = useState(null)

  useEffect(() => {
    if (!token || !peerUsername || !triggerCheck) return

    let cancelled = false
    const checkMilestones = async () => {
      try {
        const data = await getChatStats(token, peerUsername)
        if (cancelled || !data) return

        const milestone = Number(data?.milestoneReached || 0)
        const justHit = Boolean(data?.milestoneJustHit)
        if (justHit && MESSAGE_MILESTONES.includes(milestone)) {
          const key = `milestone_celebrated_v1:${milestone}`
          if (!window.localStorage.getItem(key)) {
            setPopup({
              storageKey: key,
              title: `You just sent your ${milestone}th message!`,
              description: 'Your love story in numbers keeps growing.',
            })
            return
          }
        }

        const streak = Number(data?.daysTrackedStreak || 0)
        if (STREAK_MESSAGES[streak]) {
          const key = `streak_celebrated_v1:${streak}`
          if (!window.localStorage.getItem(key)) {
            setPopup({
              storageKey: key,
              title: 'Streak Milestone',
              description: STREAK_MESSAGES[streak],
            })
          }
        }
      } catch {
        // Ignore milestone fetch errors.
      }
    }

    checkMilestones()
    return () => {
      cancelled = true
    }
  }, [peerUsername, token, triggerCheck])

  const dismiss = () => {
    if (popup?.storageKey) {
      try {
        window.localStorage.setItem(popup.storageKey, '1')
      } catch {
        // Ignore localStorage write errors.
      }
    }
    setPopup(null)
  }

  if (!popup) return null

  return (
    <div className="milestone-popup-overlay" role="dialog" aria-modal="true" aria-label="Milestone reached">
      <div className="milestone-popup-card">
        <h3 className="milestone-popup-title">{popup.title}</h3>
        <p className="milestone-popup-text">{popup.description}</p>
        <button type="button" className="milestone-popup-btn" onClick={dismiss}>Celebrate</button>
      </div>
    </div>
  )
}

export default MilestonePopup
