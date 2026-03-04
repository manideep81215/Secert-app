import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth'
import { resetFlowState, useFlowState } from '../hooks/useFlowState'
import { pushNotify } from '../lib/notifications'
import { verifySecretKey } from '../services/usersApi'
import BackIcon from '../components/BackIcon'
import './VerifyPage.css'

const BIOMETRIC_VERIFIED_KEY_PREFIX = 'verify_biometric_ok_v1:'

const getBiometricVerifiedKey = (username) => `${BIOMETRIC_VERIFIED_KEY_PREFIX}${String(username || '').trim().toLowerCase()}`

function VerifyPage() {
  const navigate = useNavigate()
  const [flow, setFlow] = useFlowState()
  const [secretKey, setSecretKey] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isBiometricLoading, setIsBiometricLoading] = useState(false)
  const [isBiometricAvailable, setIsBiometricAvailable] = useState(false)
  const autoBiometricTriedRef = useRef(false)
  const isNativePlatform = Capacitor.isNativePlatform()

  const handleUnauthorized = () => {
    toast.error('Session expired. Please login again.')
    resetFlowState(setFlow)
    navigate('/auth', { replace: true })
  }

  const triggerBiometricVerify = useCallback(async ({ manual = false, skipAvailabilityCheck = false } = {}) => {
    if (!isNativePlatform || !flow.username || !flow.token || !flow.unlocked) {
      if (manual) {
        toast.info('Biometric unlock is available only in the mobile app.')
      }
      return false
    }
    if (isLoading || isBiometricLoading) return false

    setIsBiometricLoading(true)
    try {
      if (!skipAvailabilityCheck) {
        const availability = await BiometricAuth.checkBiometry()
        const available = Boolean(availability?.isAvailable)
        setIsBiometricAvailable(available)
        if (!available) {
          if (manual) {
            toast.error('Fingerprint/Face unlock is not available on this device.')
          }
          return false
        }
      }

      await BiometricAuth.authenticate({
        reason: 'Authenticate to open chat',
        cancelTitle: 'Cancel',
        allowDeviceCredential: false,
        androidTitle: 'Biometric unlock',
        androidSubtitle: 'Use fingerprint or face to continue',
        androidConfirmationRequired: false,
      })

      setFlow((prev) => ({ ...prev, verified: true }))
      navigate('/chat')
      return true
    } catch {
      if (manual) {
        toast.error('Biometric verification failed. Use your secret key.')
      }
      return false
    } finally {
      setIsBiometricLoading(false)
    }
  }, [flow.token, flow.unlocked, flow.username, isBiometricLoading, isLoading, isNativePlatform, navigate, setFlow])

  useEffect(() => {
    if (!flow.username || !flow.token) {
      navigate('/auth')
      return
    }

    if (!flow.unlocked) {
      navigate('/games')
    }
  }, [flow.username, flow.token, flow.unlocked, navigate])

  useEffect(() => {
    let cancelled = false

    const runAutoBiometric = async () => {
      if (!isNativePlatform || !flow.username || !flow.token || !flow.unlocked) {
        if (!cancelled) setIsBiometricAvailable(false)
        return
      }

      try {
        const availability = await BiometricAuth.checkBiometry()
        if (cancelled) return
        const available = Boolean(availability?.isAvailable)
        setIsBiometricAvailable(available)
        if (!available || autoBiometricTriedRef.current) return

        const stored = await Preferences.get({ key: getBiometricVerifiedKey(flow.username) })
        if (cancelled || stored.value !== '1') return

        autoBiometricTriedRef.current = true
        await triggerBiometricVerify({ skipAvailabilityCheck: true })
      } catch {
        if (!cancelled) setIsBiometricAvailable(false)
      }
    }

    void runAutoBiometric()

    return () => {
      cancelled = true
    }
  }, [flow.token, flow.unlocked, flow.username, isNativePlatform, triggerBiometricVerify])

  const verifyPin = async (event) => {
    event.preventDefault()

    if (!secretKey.trim()) {
      toast.error('Enter your secret key.')
      return
    }

    setIsLoading(true)
    try {
      const data = await verifySecretKey(flow.userId, secretKey.trim(), flow.token)
      if (!data.verified) {
        toast.error('Wrong secret key.')
        return
      }

      setFlow((prev) => ({ ...prev, verified: true }))
      if (isNativePlatform && flow.username) {
        try {
          await Preferences.set({ key: getBiometricVerifiedKey(flow.username), value: '1' })
        } catch {
          // Keep login successful even if persistence fails.
        }
      }
      pushNotify('Checkpoint cleared', 'Bonus room is now available.')
      navigate('/chat')
    } catch (error) {
      if (error?.response?.status === 401) {
        handleUnauthorized()
        return
      }
      toast.error('Unable to reach server.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <section className="verify-page">
      <header className="verify-topbar">
        <button className="verify-nav-btn" onClick={() => navigate('/profile')} aria-label="Back"><BackIcon /></button>
        <h2>Verify</h2>
        <button className="verify-nav-btn" onClick={() => navigate('/games')}>Home</button>
      </header>

      <form className="verify-card" onSubmit={verifyPin}>
        <p className="verify-help">Enter your profile secret key.</p>
        <input
          className="verify-key-input"
          value={secretKey}
          onChange={(event) => setSecretKey(event.target.value)}
          placeholder="Secret key"
          type="password"
          autoFocus
          disabled={isLoading}
        />
        <button type="submit" className="verify-submit-btn" disabled={isLoading}>
          {isLoading ? 'Verifying...' : 'Verify'}
        </button>
        {isNativePlatform ? (
          <>
            <div className="verify-divider" role="presentation"><span>or</span></div>
            <button
              type="button"
              className="verify-biometric-btn"
              onClick={() => {
                autoBiometricTriedRef.current = true
                void triggerBiometricVerify({ manual: true })
              }}
              disabled={isLoading || isBiometricLoading}
            >
              {isBiometricLoading
                ? 'Checking biometric...'
                : (isBiometricAvailable ? 'Use Fingerprint / Face ID' : 'Check Fingerprint / Face ID')}
            </button>
          </>
        ) : null}
      </form>
    </section>
  )
}

export default VerifyPage
