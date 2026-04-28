import { useState, useEffect, useRef, useContext } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { PopupDebugContext } from '../context/PopupDebugContext'
import './LogoutReminderPopup.css'

/**
 * LogoutReminderPopup Component
 * Shows logout reminders at specific times:
 * - 1st: 8:00 PM - 8:15 PM (Submit to logout)
 * - 2nd: 8:15 PM - 8:30 PM (Completed checkbox + Submit)
 * - 3rd: 8:30 PM onwards (Only if Completed not checked on 2nd)
 */
export default function LogoutReminderPopup({ username, onLogout }) {
  const [currentPopupNumber, setCurrentPopupNumber] = useState(0)
  const [showPopup, setShowPopup] = useState(false)
  const [isCompleted, setIsCompleted] = useState(false)
  const [hasShown1st, setHasShown1st] = useState(false)
  const [hasShown2nd, setHasShown2nd] = useState(false)
  const [hasShown3rd, setHasShown3rd] = useState(false)
  const [isShaking, setIsShaking] = useState(false)
  const [showDebugMenu, setShowDebugMenu] = useState(false)
  const popupRef = useRef(null)
  const debugContext = useContext(PopupDebugContext)

  const isTestUser = username === 'test' || username === 'Test'
  const v = `v${currentPopupNumber}` // e.g. "v1", "v2", "v3"

  // Debug methods for test user
  const triggerPopup1 = () => {
    setCurrentPopupNumber(1)
    setShowPopup(true)
    setIsCompleted(false)
    setHasShown1st(true)
    setShowDebugMenu(false)
  }

  const triggerPopup2 = () => {
    setCurrentPopupNumber(2)
    setShowPopup(true)
    setIsCompleted(false)
    setHasShown2nd(true)
    setShowDebugMenu(false)
  }

  const triggerPopup3 = () => {
    setCurrentPopupNumber(3)
    setShowPopup(true)
    setHasShown3rd(true)
    setShowDebugMenu(false)
  }

  const resetDebugState = () => {
    setHasShown1st(false)
    setHasShown2nd(false)
    setHasShown3rd(false)
    setIsCompleted(false)
    setShowPopup(false)
    setCurrentPopupNumber(0)
  }

  // Register debug functions with global context
  useEffect(() => {
    if (!debugContext) return
    debugContext.registerDebugFunction('logout-popup-1', triggerPopup1)
    debugContext.registerDebugFunction('logout-popup-2', triggerPopup2)
    debugContext.registerDebugFunction('logout-popup-3', triggerPopup3)
  }, [debugContext])

  // Check current time and determine which popup to show
  useEffect(() => {
    const checkTimeAndShowPopup = () => {
      const now = new Date()
      const hours = now.getHours()
      const minutes = now.getMinutes()
      const currentTime = hours * 60 + minutes

      const time8pm   = 20 * 60
      const time815pm = 20 * 60 + 15
      const time830pm = 20 * 60 + 30

      if (currentTime >= time8pm && currentTime < time815pm && !hasShown1st) {
        setCurrentPopupNumber(1)
        setShowPopup(true)
        setHasShown1st(true)
        setIsCompleted(false)
      } else if (currentTime >= time815pm && currentTime < time830pm && !hasShown2nd) {
        setCurrentPopupNumber(2)
        setShowPopup(true)
        setHasShown2nd(true)
        setIsCompleted(false)
      } else if (currentTime >= time830pm && !hasShown3rd && !isCompleted) {
        setCurrentPopupNumber(3)
        setShowPopup(true)
        setHasShown3rd(true)
      }
    }

    const interval = setInterval(checkTimeAndShowPopup, 30000)
    checkTimeAndShowPopup()
    return () => clearInterval(interval)
  }, [hasShown1st, hasShown2nd, hasShown3rd, isCompleted])

  // Trigger shake on 3rd popup after it appears
  useEffect(() => {
    if (currentPopupNumber === 3 && showPopup) {
      const t = setTimeout(() => {
        setIsShaking(true)
        setTimeout(() => setIsShaking(false), 700)
      }, 700)
      return () => clearTimeout(t)
    }
  }, [currentPopupNumber, showPopup])

  const handleSubmit = () => {
    if (onLogout) {
      onLogout({
        timestamp: new Date().toISOString(),
        popupNumber: currentPopupNumber,
        completed: currentPopupNumber === 2 ? isCompleted : null,
      })
    }
    setShowPopup(false)
  }

  const handleClose = () => setShowPopup(false)

  // ── Dot state helper ──────────────────────────────────────────
  const getDotClass = (dotIndex) => {
    // dotIndex is 1-based
    if (dotIndex < currentPopupNumber) return 'logout-reminder-dot logout-reminder-dot--done'
    if (dotIndex === currentPopupNumber) {
      if (currentPopupNumber === 2) return 'logout-reminder-dot logout-reminder-dot--active-v2'
      if (currentPopupNumber === 3) return 'logout-reminder-dot logout-reminder-dot--active-v3'
      return 'logout-reminder-dot logout-reminder-dot--active'
    }
    return 'logout-reminder-dot'
  }

  // ── Badge ─────────────────────────────────────────────────────
  const renderBadge = () => {
    if (currentPopupNumber === 2)
      return <span className="logout-reminder-badge logout-reminder-badge--v2">Second notice</span>
    if (currentPopupNumber === 3)
      return <span className="logout-reminder-badge logout-reminder-badge--v3">Final notice</span>
    return null
  }

  const showCompletedCheckbox = currentPopupNumber === 2

  return (
    <>
      {/* Debug menu now handled by GlobalDebugMenu */}
      <AnimatePresence>
      {showPopup && (
        <motion.div
          className="logout-reminder-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <motion.div
            ref={popupRef}
            className={[
              'logout-reminder-popup',
              `logout-reminder-popup--${v}`,
              isShaking ? 'logout-reminder-popup--shaking' : '',
            ].join(' ')}
            initial={{ scale: 0.5, opacity: 0, rotate: -3, y: 60 }}
            animate={{ scale: 1, opacity: 1, rotate: 0, y: 0 }}
            exit={{ scale: 0.75, opacity: 0, rotate: -2, y: 30 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            {/* Rainbow strip */}
            <div className="logout-reminder-rainbow-bar" />

            {/* Progress bar */}
            <div className="logout-reminder-progress-track">
              <div className={`logout-reminder-progress-fill logout-reminder-progress-fill--${v}`} />
            </div>

            {/* Close button */}
            <button
              className="logout-reminder-close"
              onClick={handleClose}
              title="Close"
              aria-label="Close logout reminder"
            >
              ✕
            </button>

            {/* Header */}
            <div className="logout-reminder-header">
              {renderBadge()}
              <h2 className="logout-reminder-title">
                Logout reminder ({currentPopupNumber}/3)
              </h2>
              {/* Step dots */}
              <div className="logout-reminder-dots">
                <div className={getDotClass(1)} />
                <div className={getDotClass(2)} />
                <div className={getDotClass(3)} />
              </div>
            </div>

            {/* Content */}
            <div className="logout-reminder-content">

              {/* Animated clock */}
              <div className={`logout-reminder-clock-container logout-reminder-clock-container--${v}`}>
                {/* Sparkles */}
                <div className="logout-reminder-sparkles">
                  <div className="logout-reminder-sparkle logout-reminder-sparkle--1" />
                  <div className="logout-reminder-sparkle logout-reminder-sparkle--2" />
                  <div className="logout-reminder-sparkle logout-reminder-sparkle--3" />
                  <div className="logout-reminder-sparkle logout-reminder-sparkle--4" />
                </div>

                {/* Pulse rings */}
                <div className={`logout-reminder-pulse-ring-1 logout-reminder-pulse-ring-1--${v}`} />
                <div className={`logout-reminder-pulse-ring-2 logout-reminder-pulse-ring-2--${v}`} />

                {/* SVG clock face */}
                <svg width="80" height="80" viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="40" cy="40" r="34" fill="#fff8f0" stroke="#ff9800" strokeWidth="2" />
                  <circle cx="40" cy="40" r="28" fill="#fff" stroke="#ffe0b2" strokeWidth="1" />
                  {/* Hour hand */}
                  <line x1="40" y1="40" x2="40" y2="18" stroke="#333" strokeWidth="3" strokeLinecap="round" />
                  {/* Minute hand */}
                  <line x1="40" y1="40" x2="56" y2="48" stroke="#f44336" strokeWidth="3" strokeLinecap="round" />
                  {/* Second hand */}
                  <line
                    x1="40" y1="40" x2="40" y2="14"
                    stroke="#bbb" strokeWidth="1.5" strokeLinecap="round"
                    className="logout-reminder-second-hand"
                  />
                  <circle cx="40" cy="40" r="4" fill="#333" />
                  {/* Hour markers */}
                  <circle cx="40" cy="10" r="2" fill="#ff9800" />
                  <circle cx="40" cy="70" r="2" fill="#ff9800" />
                  <circle cx="10" cy="40" r="2" fill="#ff9800" />
                  <circle cx="70" cy="40" r="2" fill="#ff9800" />
                </svg>
              </div>

              <p className="logout-reminder-message">It's time to logout baby</p>
              <p className="logout-reminder-username">@{username}</p>
            </div>

            {/* Completed Checkbox (2nd popup only) */}
            {showCompletedCheckbox && (
              <div className="logout-reminder-checkbox-container">
                <input
                  type="checkbox"
                  id="logout-completed"
                  className="logout-reminder-checkbox"
                  checked={isCompleted}
                  onChange={(e) => setIsCompleted(e.target.checked)}
                />
                <label
                  htmlFor="logout-completed"
                  className="logout-reminder-checkbox-label"
                >
                  Logout completed
                </label>
              </div>
            )}

            {/* Actions */}
            <div className="logout-reminder-actions">
              <button
                className={`logout-reminder-btn-submit logout-reminder-btn-submit--${v}`}
                onClick={handleSubmit}
              >
                Thank you baby, I will check it
              </button>
            </div>

            {/* Info text */}
            <p className="logout-reminder-info">
              {currentPopupNumber === 1 && 'First logout reminder'}
              {currentPopupNumber === 2 && 'Check "Logout completed" if done, otherwise 3rd reminder will appear'}
              {currentPopupNumber === 3 && 'Final logout reminder'}
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  )
}