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

function formatMonthShortLabel(monthKey) {
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return monthKey || '-'
  const [year, month] = monthKey.split('-').map(Number)
  const date = new Date(year, month - 1, 1)
  return date.toLocaleString(undefined, { month: 'short' })
}

function formatDateLabel(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
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
  const monthlyBars = timeline.slice(0, 12).reverse()
  const maxBarMessages = Math.max(1, ...monthlyBars.map((row) => Number(row?.messages || 0)))
  const thisMonthTalkDays = Number(stats?.thisMonthTalkDays || 0)
  const thisMonthTotalDays = Math.max(1, Number(stats?.daysInMonth || 1))
  const talkProgress = Math.min(100, Math.round((thisMonthTalkDays / thisMonthTotalDays) * 100))

  return (
    <div className="recap-page">
      <div className="recap-card">
        <div className="recap-page-header">
          <button type="button" className="recap-page-back" onClick={() => navigate('/chat')}>{'←'}</button>
          <div className="recap-page-title">Your <span>Love Story</span> in Numbers</div>
          <div className="recap-page-sub">with @{peerUsername}</div>
        </div>

        <section className="recap-section">
          <div className="recap-section-title">This Month</div>
          <div className="recap-big-grid">
            <div className="recap-big-card">
              <div className="recap-big-icon">{'\uD83D\uDCAC'}</div>
              <div className="recap-big-number recap-pink">{Number(stats?.thisMonthMessages || 0).toLocaleString()}</div>
              <div className="recap-big-label">messages</div>
            </div>
            <div className="recap-big-card">
              <div className="recap-big-icon">{'\uD83D\uDD25'}</div>
              <div className="recap-big-number recap-amber">{Number(stats?.daysTrackedStreak || 0)}</div>
              <div className="recap-big-label">day streak</div>
            </div>
            <div className="recap-big-card">
              <div className="recap-big-icon">{'\uD83D\uDCF8'}</div>
              <div className="recap-big-number recap-violet">{Number(stats?.thisMonthPhotos || 0)}</div>
              <div className="recap-big-label">photos</div>
            </div>
            <div className="recap-big-card">
              <div className="recap-big-icon">{'\uD83C\uDFAC'}</div>
              <div className="recap-big-number recap-blue">{Number(stats?.thisMonthVideos || 0)}</div>
              <div className="recap-big-label">videos</div>
            </div>
            <div className="recap-big-card">
              <div className="recap-big-icon">{'\uD83C\uDFA4'}</div>
              <div className="recap-big-number recap-green">{Number(stats?.thisMonthVoices || 0)}</div>
              <div className="recap-big-label">voice notes</div>
            </div>
            <div className="recap-big-card">
              <div className="recap-big-icon">{'\uD83D\uDCC5'}</div>
              <div className="recap-big-number recap-amber">{`${thisMonthTalkDays}/${thisMonthTotalDays}`}</div>
              <div className="recap-big-label">days talked</div>
            </div>
          </div>
          <div className="recap-progress-wrap" aria-label="Talked-days progress">
            <div className="recap-progress-label">{`${thisMonthTalkDays}/${thisMonthTotalDays} days talked this month \uD83D\uDD25`}</div>
            <div className="recap-progress-track">
              <div className="recap-progress-fill" style={{ width: `${talkProgress}%` }} />
            </div>
          </div>
        </section>

        <section className="recap-section">
          <div className="recap-section-title">All Time Together</div>
          <div className="recap-all-time-row">
            <div className="recap-all-time-left">{'\uD83D\uDCAC'} Total messages ever</div>
            <div className="recap-all-time-value">{Number(stats?.totalMessages || 0).toLocaleString()}</div>
          </div>
          <div className="recap-all-time-row">
            <div className="recap-all-time-left">{'\uD83D\uDCF8'} Total photos shared</div>
            <div className="recap-all-time-value">{Number(stats?.totalPhotos || 0).toLocaleString()}</div>
          </div>
          <div className="recap-all-time-row">
            <div className="recap-all-time-left">{'\uD83C\uDFA4'} Total voice notes</div>
            <div className="recap-all-time-value">{Number(stats?.totalVoices || 0).toLocaleString()}</div>
          </div>
          <div className="recap-all-time-row">
            <div className="recap-all-time-left">{'\uD83C\uDFC6'} Longest streak ever</div>
            <div className="recap-all-time-value">{Number(stats?.longestStreak || 0)} days</div>
          </div>
          <div className="recap-all-time-row">
            <div className="recap-all-time-left">{'\uD83D\uDDD3\uFE0F'} First message date</div>
            <div className="recap-all-time-value">{formatDateLabel(stats?.firstMessageDate)}</div>
          </div>
        </section>

        <section className="recap-section recap-timeline-section">
          <div className="recap-section-title">Monthly Timeline</div>
          {monthlyBars.length ? (
            <div className="recap-chart-wrap">
              <div className="recap-chart">
                {monthlyBars.map((row) => {
                  const messages = Number(row?.messages || 0)
                  const heightPercent = Math.max(8, Math.round((messages / maxBarMessages) * 100))
                  return (
                    <div key={`bar-${row.month}`} className="recap-chart-col">
                      <div className="recap-chart-value">{messages.toLocaleString()}</div>
                      <div className="recap-chart-track">
                        <div className="recap-chart-bar" style={{ height: `${heightPercent}%` }} />
                      </div>
                      <div className="recap-chart-label">{formatMonthShortLabel(row.month)}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}

          {timeline.length ? (
            <ul className="recap-timeline-list">
              {timeline.map((row) => (
                <li key={String(row.month)} className="recap-timeline-item">
                  <span>{formatMonthLabel(row.month)}</span>
                  <strong>{Number(row.messages || 0).toLocaleString()} msgs</strong>
                </li>
              ))}
            </ul>
          ) : (
            <div className="recap-muted">No timeline data yet.</div>
          )}
        </section>

        <div className="recap-since">Talking since {formatDateLabel(stats?.firstMessageDate)}</div>
      </div>
    </div>
  )
}

export default RecapPage
