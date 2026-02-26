import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { toast } from 'react-toastify'
import { resetFlowScores, resetFlowState, useFlowState } from '../hooks/useFlowState'
import {
  getUserById,
  hasSecretKey,
  setSecretKey as saveSecretKeyApi,
  verifySecretKey as verifySecretKeyApi,
} from '../services/usersApi'
import BackIcon from '../components/BackIcon'
import './ProfilePage.css'

function ProfilePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [flow, setFlow] = useFlowState()
  const [showSecretKeyModal, setShowSecretKeyModal] = useState(false)
  const [secretKey, setSecretKey] = useState('')
  const [isFirstTime, setIsFirstTime] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const longPressTimerRef = useRef(null)
  const longPressTriggeredRef = useRef(false)
  const suppressNextClickRef = useRef(false)
  const wins = flow.wins || { rps: 0, coin: 0, ttt: 0 }
  const totalWins = useMemo(() => wins.rps + wins.coin + wins.ttt, [wins])
  const previousPage = location.state?.from || '/games'

  // Only redirect if not authenticated on initial load
  useEffect(() => {
    if (!flow.username || !flow.token) {
      toast.error('You need to login first')
      navigate('/auth', { replace: true })
      return
    }
    if (!flow.userId) return

    const loadProfileFromDb = async () => {
      try {
        const dbUser = await getUserById(flow.userId, flow.token)
        if (!dbUser) return
        setFlow((prev) => ({
          ...prev,
          username: dbUser.username || prev.username,
          name: dbUser.name || prev.name || '',
          phone: dbUser.phone || '',
          dob: dbUser.dob || '',
          email: dbUser.email || '',
          role: dbUser.role || prev.role || 'game',
        }))
      } catch (error) {
        if (error?.response?.status === 401) {
          handleUnauthorized()
          return
        }
        console.error('Failed loading profile from database', error)
        toast.error('Failed to load profile details.')
      }
    }

    loadProfileFromDb()
  }, [flow.userId, flow.token, flow.username, navigate, setFlow])

  const updateProfile = (key, value) => {
    setFlow((prev) => ({ ...prev, [key]: value }))
  }

  const handleUnauthorized = () => {
    toast.error('Session expired. Please login again.')
    resetFlowState(setFlow)
    navigate('/auth', { replace: true })
  }

  const openSecretKeyModal = async () => {
    setIsLoading(true)
    try {
      const data = await hasSecretKey(flow.userId, flow.token)
      setIsFirstTime(!data?.exists)
      setShowSecretKeyModal(true)
      setSecretKey('')
    } catch (error) {
      if (error?.response?.status === 401) {
        handleUnauthorized()
        return
      }
      console.error('Error checking secret key:', error)
      toast.error('Unable to reach server.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleResetScoreClick = () => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false
      return
    }
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false
      return
    }
    resetFlowScores(setFlow)
    toast.success('Score reset successfully!')
  }

  const handleResetScoreLongPressStart = (event) => {
    if (isLoading) return
    if (event?.pointerType === 'mouse' && event?.button !== 0) return
    if ((flow.role || 'game') !== 'chat') {
      toast.error('Long press action is only available for chat role users.')
      return
    }
    longPressTriggeredRef.current = false
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true
      suppressNextClickRef.current = true
      openSecretKeyModal()
      longPressTimerRef.current = null
    }, 1000)
  }

  const handleResetScoreLongPressEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const submitSecretKey = async () => {
    if (!secretKey.trim()) {
      toast.error('Secret key cannot be empty')
      return
    }

    setIsLoading(true)
    try {
      if (isFirstTime) {
        await saveSecretKeyApi(flow.userId, secretKey, flow.token)
        setFlow((prev) => ({ ...prev, verified: true }))
        toast.success('Confirmation key created successfully! Redirecting to chat...')
        setShowSecretKeyModal(false)
        setSecretKey('')
        setTimeout(() => {
          navigate('/users')
        }, 500)
      } else {
        const data = await verifySecretKeyApi(flow.userId, secretKey, flow.token)
        if (data?.verified) {
          setFlow((prev) => ({ ...prev, verified: true }))
          toast.success('Confirmation key verified! Redirecting to chat...')
          setShowSecretKeyModal(false)
          setSecretKey('')
          setTimeout(() => {
            navigate('/users')
          }, 500)
        } else {
          toast.error('Wrong confirmation key! Few chances left!')
          setSecretKey('')
        }
      }
    } catch (error) {
      if (error?.response?.status === 401) {
        handleUnauthorized()
        return
      }
      console.error('Error with secret key:', error)
      toast.error('An error occurred. Please try again.')
      setSecretKey('')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <section className="profile-page">
      <header className="profile-topbar">
        <button className="profile-nav-btn" onClick={() => navigate(previousPage)} aria-label="Back"><BackIcon /></button>
        <h2>Profile</h2>
        <button className="profile-nav-btn" onClick={() => navigate(previousPage)}>Home</button>
      </header>

      <article className="profile-card">
        <label className="profile-field">
          <span>Username</span>
          <input value={flow.username || ''} readOnly />
        </label>
        <label className="profile-field">
          <span>Name</span>
          <input value={flow.name || ''} readOnly />
        </label>
        <label className="profile-field">
          <span>Phone Number</span>
          <input
            value={flow.phone || ''}
            onChange={(event) => updateProfile('phone', event.target.value)}
            placeholder="+1 (555) 000-0000"
          />
        </label>
        <label className="profile-field">
          <span>DOB</span>
          <input type="date" value={flow.dob || ''} onChange={(event) => updateProfile('dob', event.target.value)} />
        </label>
        <label className="profile-field">
          <span>Email</span>
          <input
            type="email"
            value={flow.email || ''}
            onChange={(event) => updateProfile('email', event.target.value)}
            placeholder="name@email.com"
          />
        </label>

        <div className="profile-stats">
          <h3>User Statistics</h3>
          <p>RPS Wins: {wins.rps}</p>
          <p>Coin Wins: {wins.coin}</p>
          <p>Tic-Tac-Toe Wins: {wins.ttt}</p>
          <p>Total Wins: {totalWins}</p>
        </div>

        <button 
          className="profile-reset-secret-btn" 
          onClick={handleResetScoreClick}
          onPointerDown={handleResetScoreLongPressStart}
          onPointerUp={handleResetScoreLongPressEnd}
          onPointerLeave={handleResetScoreLongPressEnd}
          onPointerCancel={handleResetScoreLongPressEnd}
          disabled={isLoading}
        >
          Reset Score
        </button>
      </article>

      {/* Confirmation Key Modal */}
      {showSecretKeyModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 className="modal-title">
              {isFirstTime ? 'Create Confirmation Key' : 'Verify Confirmation Key'}
            </h3>
            <p className="modal-description">
              {isFirstTime 
                ? 'Create a confirmation key for secure access to chat'
                : 'Enter your confirmation key to continue to chat'}
            </p>
            <input
              type="password"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && !isLoading && submitSecretKey()}
              placeholder="Enter your confirmation key"
              autoFocus
              disabled={isLoading}
              className="modal-input"
            />
            <div className="modal-buttons">
              <button
                onClick={submitSecretKey}
                disabled={isLoading}
                className="modal-btn modal-btn-primary"
              >
                {isLoading ? 'Processing...' : isFirstTime ? 'Create' : 'Verify'}
              </button>
              <button
                onClick={() => {
                  setShowSecretKeyModal(false)
                  setSecretKey('')
                }}
                disabled={isLoading}
                className="modal-btn modal-btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default ProfilePage
