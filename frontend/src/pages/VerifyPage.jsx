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
    if (!isNativePlatform || !flow.username || !flow.token) {
      if (manual) {
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
          // If availability check fails, still attempt authenticate().
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
  }, [flow.token, flow.username, isBiometricLoading, isLoading, isNativePlatform, navigate, setFlow])

  useEffect(() => {
    if (!flow.username || !flow.token) {
      navigate('/auth')
    }
  }, [flow.username, flow.token, navigate])

  useEffect(() => {
    let cancelled = false

    const runAutoBiometric = async () => {
      if (!isNativePlatform || !flow.username || !flow.token) {
        if (!cancelled) setIsBiometricAvailable(false)
        return
      }

      try {
        if (autoBiometricTriedRef.current) return
        const availability = await BiometricAuth.checkBiometry()
        if (cancelled) return
        setIsBiometricAvailable(Boolean(availability?.isAvailable))
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
  }, [flow.token, flow.username, isNativePlatform, triggerBiometricVerify])

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
                : (isBiometricAvailable
                    ? 'Use Fingerprint / Face / Screen Lock'
                    : 'Check Fingerprint / Face / Screen Lock')}
            </button>
          </>
        ) : null}
      </form>
    </section>
  )
}

export default VerifyPage
