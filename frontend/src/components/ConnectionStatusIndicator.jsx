import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import './ConnectionStatusIndicator.css'

/**
 * ConnectionStatusIndicator Component
 * Displays the real-time connection status with three states:
 * - Connected: Green linked icon + 100%
 * - Disconnected: Red unlinked icon + 0%
 * - Connecting: Animated percentage (0-90%) with icon
 */
export default function ConnectionStatusIndicator({ isConnected, isConnecting }) {
  const [connectPercentage, setConnectPercentage] = useState(0)

  useEffect(() => {
    if (isConnected) {
      setConnectPercentage(100)
    } else if (isConnecting) {
      setConnectPercentage(0)
      // Animate percentage from 0 to 90 during connection attempt
      const startTime = Date.now()
      const animationDuration = 8000 // 8 seconds to reach ~90%
      const interval = setInterval(() => {
        const elapsed = Date.now() - startTime
        const progress = Math.min((elapsed / animationDuration) * 90, 90)
        setConnectPercentage(Math.round(progress))
      }, 100)
      return () => clearInterval(interval)
    } else {
      setConnectPercentage(0)
    }
  }, [isConnecting, isConnected])

  const getStatusLabel = () => {
    if (isConnecting) return `Connecting... ${connectPercentage}%`
    if (isConnected) return 'Connected 100%'
    return 'Disconnected 0%'
  }

  const getStatusClass = () => {
    if (isConnecting) return 'connecting'
    if (isConnected) return 'connected'
    return 'disconnected'
  }

  return (
    <div className={`connection-status-indicator ${getStatusClass()}`} title={getStatusLabel()}>
      {isConnecting ? (
        // Connecting state with percentage
        <motion.div
          className="connection-progress-container"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          <svg className="connection-progress-circle" viewBox="0 0 100 100">
            <defs>
              <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ff9800" />
                <stop offset="50%" stopColor="#ffc107" />
                <stop offset="100%" stopColor="#ff9800" />
              </linearGradient>
            </defs>
            {/* Background circle */}
            <circle cx="50" cy="50" r="40" className="progress-circle-bg" />
            {/* Progress circle */}
            <motion.circle
              cx="50"
              cy="50"
              r="40"
              className="progress-circle-fill"
              initial={{ strokeDashoffset: 251 }}
              animate={{ strokeDashoffset: 251 - (connectPercentage / 100) * 251 }}
              transition={{ duration: 0.3 }}
            />
          </svg>
          <motion.span
            className="connection-percentage"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.2 }}
            key={connectPercentage}
          >
            {connectPercentage}%
          </motion.span>
        </motion.div>
      ) : isConnected ? (
        // Connected state - Green linked icon
        <motion.svg
          className="connection-icon connected-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          {/* Linked icon */}
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </motion.svg>
      ) : (
        // Disconnected state - Red unlinked icon
        <motion.svg
          className="connection-icon disconnected-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          {/* Unlinked icon with X */}
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          <line x1="1" y1="1" x2="23" y2="23" strokeLinecap="round" />
        </motion.svg>
      )}

      {/* Tooltip on hover */}
      <span className="connection-status-label">{getStatusLabel()}</span>
    </div>
  )
}
