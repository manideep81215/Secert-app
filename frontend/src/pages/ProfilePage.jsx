import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { toast } from 'react-toastify'
import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth'
import { resetFlowScores, resetFlowState, useFlowState } from '../hooks/useFlowState'
import {
  getUserById,
  hasSecretKey,
  setSecretKey as saveSecretKeyApi,
  verifySecretKey as verifySecretKeyApi,
} from '../services/usersApi'
import BackIcon from '../components/BackIcon'
import './ProfilePage.css'

const BIOMETRIC_VERIFIED_KEY_PREFIX = 'verify_biometric_ok_v1:'
const getBiometricVerifiedKey = (username) => `${BIOMETRIC_VERIFIED_KEY_PREFIX}${String(username || '').trim().toLowerCase()}`
const FingerprintIcon = ({ className = '' }) => (
  <svg className={className} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <g fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 25c0-10 8-18 18-18s18 8 18 18" />
      <path d="M9 30c0-13 10-23 23-23s23 10 23 23" />
      <path d="M19 32v7c0 7-3 13-8 18" />
      <path d="M27 27v16c0 7-3 13-8 17" />
      <path d="M35 27v20c0 6-2 11-6 15" />
      <path d="M43 31v10c0 8-3 15-8 20" />
      <path d="M51 34v7c0 10-4 18-10 24" />
      <path d="M23 53c-1 2-3 4-5 6" />
    </g>
  </svg>
)

function ProfilePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [flow, setFlow] = useFlowState()
  const [showSecretKeyModal, setShowSecretKeyModal] = useState(false)
  const [secretKey, setSecretKey] = useState('')
  const [isFirstTime, setIsFirstTime] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isBiometricLoading, setIsBiometricLoading] = useState(false)
  const [isBiometricAvailable, setIsBiometricAvailable] = useState(false)
  const longPressTimerRef = useRef(null)
  const longPressTriggeredRef = useRef(false)
  const suppressNextClickRef = useRef(false)
  const wins = flow.wins || { rps: 0, coin: 0, ttt: 0 }
  const totalWins = useMemo(() => wins.rps + wins.coin + wins.ttt, [wins])
  const previousPage = location.state?.from || '/games'
  const isNativePlatform = Capacitor.isNativePlatform()

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
        if (typeof document !== 'undefined') {
          document.activeElement?.blur?.()
        }
        setFlow((prev) => ({ ...prev, verified: true }))
        setShowSecretKeyModal(false)
        setSecretKey('')
        if (typeof window !== 'undefined') {
          setTimeout(() => window.dispatchEvent(new Event('resize')), 80)
        }
        setTimeout(() => {
          navigate('/users')
        }, 500)
      } else {
        const data = await verifySecretKeyApi(flow.userId, secretKey, flow.token)
        if (data?.verified) {
          if (typeof document !== 'undefined') {
            document.activeElement?.blur?.()
          }
          setFlow((prev) => ({ ...prev, verified: true }))
          setShowSecretKeyModal(false)
          setSecretKey('')
          if (typeof window !== 'undefined') {
            setTimeout(() => window.dispatchEvent(new Event('resize')), 80)
          }
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

  const triggerBiometricVerify = useCallback(async ({ manual = false, skipAvailabilityCheck = false } = {}) => {
    if (!isNativePlatform || !showSecretKeyModal || isFirstTime || !flow.username || !flow.token) {
      if (manual && !isNativePlatform) {
        toast.info('Biometric unlock is available only in the mobile app.')
      }
      return false
    }
    if (isLoading || isBiometricLoading) return false

    setIsBiometricLoading(true)
    try {
      if (!skipAvailabilityCheck) {
        try {
          const availability = await BiometricAuth.checkBiometry()
          setIsBiometricAvailable(Boolean(availability?.isAvailable))
        } catch {
          // Still try authenticate below.
        }
      }

      await BiometricAuth.authenticate({
        reason: 'Authenticate to verify access',
        cancelTitle: 'Cancel',
        allowDeviceCredential: true,
        iosFallbackTitle: 'Use passcode',
        androidTitle: 'Verify identity',
        androidSubtitle: 'Use fingerprint, face, or screen lock to continue',
        androidConfirmationRequired: false,
      })

      if (flow.username) {
        try {
          await Preferences.set({ key: getBiometricVerifiedKey(flow.username), value: '1' })
        } catch {
          // Ignore local persistence failures.
        }
      }
      if (typeof document !== 'undefined') {
        document.activeElement?.blur?.()
      }
      setFlow((prev) => ({ ...prev, verified: true }))
      setShowSecretKeyModal(false)
      setSecretKey('')
      if (typeof window !== 'undefined') {
        setTimeout(() => window.dispatchEvent(new Event('resize')), 80)
      }
      navigate('/users')
      return true
    } catch {
      if (manual) {
        toast.error('Biometric verification failed. Use confirmation key.')
      }
      return false
    } finally {
      setIsBiometricLoading(false)
    }
  }, [
    flow.token,
    flow.username,
    isBiometricLoading,
    isFirstTime,
    isLoading,
    isNativePlatform,
    navigate,
    setFlow,
    showSecretKeyModal,
  ])

  useEffect(() => {
    let cancelled = false

    const loadBiometricAvailability = async () => {
      if (!showSecretKeyModal || isFirstTime || !isNativePlatform || !flow.username || !flow.token) {
        if (!cancelled) setIsBiometricAvailable(false)
        return
      }
      try {
        const availability = await BiometricAuth.checkBiometry()
        if (cancelled) return
        setIsBiometricAvailable(Boolean(availability?.isAvailable))
      } catch {
        if (!cancelled) setIsBiometricAvailable(false)
      }
    }

    void loadBiometricAvailability()
    return () => {
      cancelled = true
    }
  }, [flow.token, flow.username, isFirstTime, isNativePlatform, showSecretKeyModal])

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
            {!isFirstTime && isNativePlatform ? (
              <button
                type="button"
                onClick={() => {
                  void triggerBiometricVerify({ manual: true })
                }}
                disabled={isLoading || isBiometricLoading}
                className="modal-btn modal-btn-secondary"
                title={isBiometricLoading ? 'Checking biometric...' : 'Use biometric'}
                aria-label={isBiometricLoading ? 'Checking biometric' : 'Use biometric'}
              >
                <FingerprintIcon className={`modal-biometric-icon ${isBiometricAvailable ? 'available' : 'unavailable'}`} />
              </button>
            ) : null}
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
