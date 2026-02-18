import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { resetFlowState, useFlowState } from '../hooks/useFlowState'
import { pushNotify } from '../lib/notifications'
import './VerifyPage.css'

const API_BASE = 'http://localhost:8080/api/app'

function VerifyPage() {
  const navigate = useNavigate()
  const [flow, setFlow] = useFlowState()
  const [secretKey, setSecretKey] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleUnauthorized = () => {
    toast.error('Session expired. Please login again.')
    resetFlowState(setFlow)
    navigate('/auth', { replace: true })
  }

  useEffect(() => {
    if (!flow.username || !flow.token) {
      navigate('/auth')
      return
    }

    if (!flow.unlocked) {
      navigate('/games')
    }
  }, [flow.username, flow.token, flow.unlocked, navigate])

  const verifyPin = async (event) => {
    event.preventDefault()

    if (!secretKey.trim()) {
      toast.error('Enter your secret key.')
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch(`${API_BASE}/users/${flow.userId}/verify-secret-key`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${flow.token}`,
        },
        body: JSON.stringify({ secretKey: secretKey.trim() }),
      })

      if (response.status === 401) {
        handleUnauthorized()
        return
      }

      if (!response.ok) {
        toast.error('Verification failed.')
        return
      }

      const data = await response.json()
      if (!data.verified) {
        toast.error('Wrong secret key.')
        return
      }

      setFlow((prev) => ({ ...prev, verified: true }))
      pushNotify('Checkpoint cleared', 'Bonus room is now available.')
      navigate('/users')
    } catch {
      toast.error('Unable to reach server.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <section className="verify-page">
      <header className="verify-topbar">
        <button className="verify-nav-btn" onClick={() => navigate('/profile')}>Back</button>
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
      </form>
    </section>
  )
}

export default VerifyPage
