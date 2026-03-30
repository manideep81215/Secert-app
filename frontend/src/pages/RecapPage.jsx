import { useEffect, useMemo, useRef, useState } from 'react'
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

function formatRecapPeriodLabel(startValue, endValue) {
  const startDate = startValue ? new Date(startValue) : null
  const endDate = endValue ? new Date(endValue) : null
  if (!startDate || !endDate || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return 'Recap Period'
  }
  const nextMonthStart = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 1)
  const isFullMonthWindow =
    startDate.getDate() === 1 &&
    endDate.getDate() === 1 &&
    endDate.getFullYear() === nextMonthStart.getFullYear() &&
    endDate.getMonth() === nextMonthStart.getMonth()
  if (isFullMonthWindow) {
    return startDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  }
  const startLabel = startDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const endLabel = endDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${startLabel} - ${endLabel}`
}

function PeriodSection({
  title,
  messages,
  streak,
  photos,
  videos,
  voices,
  talkDays,
  totalDays,
  progressLabel,
}) {
  const safeTotalDays = Math.max(1, Number(totalDays || 1))
  const safeTalkDays = Number(talkDays || 0)
  const talkProgress = Math.min(100, Math.round((safeTalkDays / safeTotalDays) * 100))

  return (
    <section className="recap-section">
      <div className="recap-section-title">{title}</div>
      <div className="recap-big-grid">
        <div className="recap-big-card">
          <div className="recap-big-icon">{'\uD83D\uDCAC'}</div>
          <div className="recap-big-number recap-pink">{Number(messages || 0).toLocaleString()}</div>
          <div className="recap-big-label">messages</div>
        </div>
        <div className="recap-big-card">
          <div className="recap-big-icon">{'\uD83D\uDD25'}</div>
          <div className="recap-big-number recap-amber">{Number(streak || 0)}</div>
          <div className="recap-big-label">day streak</div>
        </div>
        <div className="recap-big-card">
          <div className="recap-big-icon">{'\uD83D\uDCF8'}</div>
          <div className="recap-big-number recap-violet">{Number(photos || 0)}</div>
          <div className="recap-big-label">photos</div>
        </div>
        <div className="recap-big-card">
          <div className="recap-big-icon">{'\uD83C\uDFAC'}</div>
          <div className="recap-big-number recap-blue">{Number(videos || 0)}</div>
          <div className="recap-big-label">videos</div>
        </div>
        <div className="recap-big-card">
          <div className="recap-big-icon">{'\uD83C\uDFA4'}</div>
          <div className="recap-big-number recap-green">{Number(voices || 0)}</div>
          <div className="recap-big-label">voice notes</div>
        </div>
        <div className="recap-big-card">
          <div className="recap-big-icon">{'\uD83D\uDCC5'}</div>
          <div className="recap-big-number recap-amber">{`${safeTalkDays}/${safeTotalDays}`}</div>
          <div className="recap-big-label">days talked</div>
        </div>
      </div>
      <div className="recap-progress-wrap" aria-label="Talked-days progress">
        <div className="recap-progress-label">{progressLabel}</div>
        <div className="recap-progress-track">
          <div className="recap-progress-fill" style={{ width: `${talkProgress}%` }} />
        </div>
      </div>
    </section>
  )
}

function RecapPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [flow] = useFlowState()
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const loadedPeerRef = useRef('')

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
      if (!peerUsername) {
        setStats(null)
        loadedPeerRef.current = ''
      }
      setError('')
      setLoading(false)
      return
    }

    let cancelled = false
    const hasLoadedCurrentPeer = loadedPeerRef.current === peerUsername && Boolean(stats)

    const loadStats = async () => {
      try {
        setLoading(!hasLoadedCurrentPeer)
        setError('')
        const data = await getChatStats(flow.token, peerUsername)
        if (cancelled) return
        setStats(data)
        loadedPeerRef.current = peerUsername
      } catch {
        if (cancelled) return
        if (!hasLoadedCurrentPeer) {
          setError('Failed to load recap right now.')
          setStats(null)
          loadedPeerRef.current = ''
        }
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
  const previousPeriodLabel = formatRecapPeriodLabel(stats?.recapPeriodStart, stats?.recapPeriodEnd)
  const currentPeriodLabel = formatRecapPeriodLabel(stats?.currentPeriodStart, stats?.currentPeriodEnd)

  return (
    <div className="recap-page">
      <div className="recap-card">
        <div className="recap-page-header">
          <button type="button" className="recap-page-back" onClick={() => navigate('/chat')}>{'←'}</button>
          <div className="recap-page-title">Your <span>Monthly Recap</span> in Numbers</div>
          <div className="recap-page-sub">with @{peerUsername}</div>
        </div>

        <PeriodSection
          title={previousPeriodLabel}
          messages={stats?.recapMessages}
          streak={stats?.longestStreak}
          photos={stats?.recapPhotos}
          videos={stats?.recapVideos}
          voices={stats?.recapVoices}
          talkDays={stats?.recapTalkDays}
          totalDays={stats?.recapDaysInMonth}
          progressLabel={`${Number(stats?.recapTalkDays || 0)}/${Math.max(1, Number(stats?.recapDaysInMonth || 1))} days talked in ${previousPeriodLabel} \uD83D\uDD25`}
        />

        <PeriodSection
          title={currentPeriodLabel}
          messages={stats?.currentMessages}
          streak={stats?.daysTrackedStreak}
          photos={stats?.currentPhotos}
          videos={stats?.currentVideos}
          voices={stats?.currentVoices}
          talkDays={stats?.currentTalkDays}
          totalDays={stats?.currentDaysInPeriod}
          progressLabel={`${Number(stats?.currentTalkDays || 0)}/${Math.max(1, Number(stats?.currentDaysInPeriod || 1))} days talked in ${currentPeriodLabel} \uD83D\uDD25`}
        />

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
