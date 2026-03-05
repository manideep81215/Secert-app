import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useFlowState } from '../hooks/useFlowState'
import { getChatStats } from '../services/messagesApi'
import './RecapPage.css'

function formatMonthLabel(monthKey) {
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return monthKey || '-'
  const [year, month] = monthKey.split('-').map(Number)
  const date = new Date(year, month - 1, 1)
  return date.toLocaleString(undefined, { month: 'long', year: 'numeric' })
}

function RecapPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [flow] = useFlowState()
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const peerUsername = useMemo(() => {
    const fromSearch = new URLSearchParams(location.search).get('peer')
    if (fromSearch) return String(fromSearch).trim().toLowerCase()
    const fromState = String(location.state?.peerUsername || '').trim().toLowerCase()
    if (fromState) return fromState

    if (!flow?.username) return ''
    try {
      const key = `active_chat_peer_v1:${String(flow.username || '').trim().toLowerCase()}`
      return String(window.localStorage.getItem(key) || '').trim().toLowerCase()
    } catch {
      return ''
    }
  }, [flow?.username, location.search, location.state])

  useEffect(() => {
    if (!flow?.token || !peerUsername) {
      setLoading(false)
      return
    }

    let cancelled = false
    const loadStats = async () => {
      try {
        setLoading(true)
        setError('')
        const data = await getChatStats(flow.token, peerUsername)
        if (cancelled) return
        setStats(data)
      } catch {
        if (cancelled) return
        setError('Failed to load recap right now.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadStats()
    return () => {
      cancelled = true
    }
  }, [flow?.token, peerUsername])

  if (loading) {
    return <div className="recap-page"><div className="recap-card recap-muted">Loading recap...</div></div>
  }

  if (!peerUsername) {
    return <div className="recap-page"><div className="recap-card recap-muted">Select a chat first, then open recap.</div></div>
  }

  if (error) {
    return <div className="recap-page"><div className="recap-card recap-error">{error}</div></div>
  }

  const timeline = Array.isArray(stats?.monthlyTimeline) ? stats.monthlyTimeline : []

  return (
    <div className="recap-page">
      <div className="recap-card">
        <div className="recap-header">
          <h2 className="recap-title">Conversation Recap</h2>
          <button type="button" className="recap-back" onClick={() => navigate('/chat')}>Back to Chat</button>
        </div>
        <div className="recap-peer">With @{peerUsername}</div>

        <div className="recap-grid">
          <div className="recap-box">
            <p className="recap-label">This Month Messages</p>
            <p className="recap-value">{Number(stats?.thisMonthMessages || 0)}</p>
          </div>
          <div className="recap-box">
            <p className="recap-label">This Month Photos</p>
            <p className="recap-value">{Number(stats?.thisMonthPhotos || 0)}</p>
          </div>
          <div className="recap-box">
            <p className="recap-label">This Month Voices</p>
            <p className="recap-value">{Number(stats?.thisMonthVoices || 0)}</p>
          </div>
          <div className="recap-box">
            <p className="recap-label">Days Talked This Month</p>
            <p className="recap-value">{`${Number(stats?.thisMonthTalkDays || 0)}/${Number(stats?.daysInMonth || 0)}`}</p>
          </div>
          <div className="recap-box">
            <p className="recap-label">All Time Messages</p>
            <p className="recap-value">{Number(stats?.totalMessages || 0)}</p>
          </div>
          <div className="recap-box">
            <p className="recap-label">All Time Photos</p>
            <p className="recap-value">{Number(stats?.totalPhotos || 0)}</p>
          </div>
          <div className="recap-box">
            <p className="recap-label">All Time Voices</p>
            <p className="recap-value">{Number(stats?.totalVoices || 0)}</p>
          </div>
          <div className="recap-box">
            <p className="recap-label">First Message</p>
            <p className="recap-value">{stats?.firstMessageDate || '-'}</p>
          </div>
          <div className="recap-box">
            <p className="recap-label">Current Streak</p>
            <p className="recap-value">{Number(stats?.daysTrackedStreak || 0)} days</p>
          </div>
          <div className="recap-box">
            <p className="recap-label">Longest Streak</p>
            <p className="recap-value">{Number(stats?.longestStreak || 0)} days</p>
          </div>
        </div>

        <div className="recap-timeline">
          <h3>Monthly Timeline</h3>
          {timeline.length ? (
            <ul className="recap-timeline-list">
              {timeline.map((row) => (
                <li key={String(row.month)} className="recap-timeline-item">
                  <span>{formatMonthLabel(row.month)}</span>
                  <strong>{Number(row.messages || 0)} msgs</strong>
                </li>
              ))}
            </ul>
          ) : (
            <div className="recap-muted">No timeline data yet.</div>
          )}
        </div>
      </div>
    </div>
  )
}

export default RecapPage
