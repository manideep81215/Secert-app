import { useState, useTransition } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { useFlowState } from '../hooks/useFlowState'
import { loginUser, registerUser } from '../services/authApi'
import './AuthPage.css'

const EYE_ICON = '\u{1F441}'
const HIDE_ICON = '\u{1F648}'
const THEME_ASSETS = {
  logo: '/theme/simp-games-quest-logo.png',
  rps: '/theme/icon-rock-paper-scissors.png',
  ttt: '/theme/icon-tic-tac-toe.png',
  coin: '/theme/icon-coin.png',
}

function AuthPage() {
  const navigate = useNavigate()
  const [flow, setFlow] = useFlowState()
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState(flow.username || '')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [name, setName] = useState(flow.name || '')
  const [phone, setPhone] = useState(flow.phone || '')
  const [email, setEmail] = useState(flow.email || '')
  const [dob, setDob] = useState(flow.dob || '')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [, startTransition] = useTransition()

  const submit = async (event) => {
    event.preventDefault()
    if (isSubmitting) return
    if (!username.trim() || password.length < 4) {
      toast.error('Enter username and min 4-char password.')
      return
    }
    if (mode === 'register' && password !== confirmPassword) {
      toast.error('Password and confirm password must match.')
      return
    }
    if (mode === 'register' && (!name.trim() || !phone.trim() || !email.trim() || !dob.trim())) {
      toast.error('Fill name, phone, email and DOB.')
      return
    }

    try {
      setIsSubmitting(true)
      const payload = mode === 'register'
        ? {
            username: username.trim(),
            password,
            name: name.trim(),
            phone: phone.trim(),
            email: email.trim(),
            dob: dob.trim(),
          }
        : { username: username.trim(), password }
      const response = mode === 'login' ? await loginUser(payload) : await registerUser(payload)

      setFlow({
        userId: response.userId,
        username: response.username,
        token: response.token,
        refreshToken: response.refreshToken || '',
        role: response.role || 'game',
        name: mode === 'register' ? name.trim() : (flow.name || ''),
        phone: mode === 'register' ? phone.trim() : (flow.phone || ''),
        dob: mode === 'register' ? dob.trim() : (flow.dob || ''),
        email: mode === 'register' ? email.trim() : (flow.email || ''),
        wins: flow.wins || { rps: 0, coin: 0, ttt: 0 },
        unlocked: false,
        verified: false,
      })
      toast.success(
        response.message || `${mode === 'login' ? 'Welcome back' : 'Profile created'} ${response.username}`,
        { toastId: `auth-success-${mode}` },
      )
      navigate('/games')
    } catch (error) {
      const status = Number(error?.response?.status || 0)
      const message = status === 401
        ? 'Invalid email or password'
        : (error?.response?.data?.message || error?.response?.data?.detail || 'Authentication failed')
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <motion.section
      className="auth-showcase"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35 }}
    >
      <motion.div
        className="theme-top"
        initial={{ y: -14, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.35, delay: 0.05 }}
      >
        <div className="game-logo">
          <img className="game-logo-image" src={THEME_ASSETS.logo} alt="Simp Games Quest" />
        </div>
      </motion.div>

      <motion.div
        className="card-below-logo"
        initial={{ y: 18, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, delay: 0.08 }}
      >
        <motion.article
          className="parchment-board"
          layout
          transition={{ duration: 0.25 }}
        >
          <h3 className="sign-title">{mode === 'login' ? 'Sign In' : 'Register'}</h3>

          <form className="parchment-form" onSubmit={submit}>
            <input className="input-fantasy" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" />

            <AnimatePresence initial={false}>
              {mode === 'register' && (
                <motion.div
                  key="register-fields"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22 }}
                  style={{ overflow: 'hidden', display: 'grid', gap: '0.7rem' }}
                >
                <input className="input-fantasy" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
                <input className="input-fantasy" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" />
                <input className="input-fantasy" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
                <input className="input-fantasy" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
                </motion.div>
              )}
            </AnimatePresence>

            <div className="password-wrap">
              <input
                className="input-fantasy"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
              />
              <button
                type="button"
                className="toggle-visibility"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? HIDE_ICON : EYE_ICON}
              </button>
            </div>

            <AnimatePresence initial={false}>
              {mode === 'register' && (
                <motion.div
                  key="confirm-password"
                  className="password-wrap"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  style={{ overflow: 'hidden' }}
                >
                  <input
                    className="input-fantasy"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm Password"
                  />
                  <button
                    type="button"
                    className="toggle-visibility"
                    onClick={() => setShowConfirmPassword((prev) => !prev)}
                    aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                  >
                    {showConfirmPassword ? HIDE_ICON : EYE_ICON}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <motion.button className="btn-enter" type="submit" whileTap={{ scale: 0.97 }} disabled={isSubmitting}>
              {isSubmitting ? 'Please wait...' : mode === 'login' ? 'Enter' : 'Create'}
            </motion.button>
          </form>

          <p className="register-text">{mode === 'login' ? "Don't have an account?" : 'Already have an account?'}</p>
          <motion.button
            type="button"
            className="link-switch"
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              startTransition(() => {
                setMode((prev) => (prev === 'login' ? 'register' : 'login'))
                setConfirmPassword('')
                setShowConfirmPassword(false)
              })
            }}
          >
            {mode === 'login' ? 'Register' : 'Sign In'}
          </motion.button>
        </motion.article>
      </motion.div>

      <motion.div
        className="game-icon-row"
        aria-hidden="true"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.12 }}
      >
        <div className="game-icon-badge">
          <img className="game-icon-image" src={THEME_ASSETS.rps} alt="Rock Paper Scissors" />
        </div>
        <div className="game-icon-badge">
          <img className="game-icon-image" src={THEME_ASSETS.ttt} alt="Tic Tac Toe" />
        </div>
        <div className="game-icon-badge">
          <img className="game-icon-image" src={THEME_ASSETS.coin} alt="Coin Toss" />
        </div>
      </motion.div>

      <div className="theme-leaves" aria-hidden="true">
        <span className="leaf leaf-a" />
        <span className="leaf leaf-b" />
        <span className="leaf leaf-c" />
        <span className="leaf leaf-d" />
      </div>
    </motion.section>
  )
}

export default AuthPage
