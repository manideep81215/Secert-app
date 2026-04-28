import { useState, useContext } from 'react'
import { motion } from 'framer-motion'
import { PopupDebugContext } from '../context/PopupDebugContext'
import './GlobalDebugMenu.css'

/**
 * GlobalDebugMenu Component
 * Centralized debug menu for test user to trigger all popups in the app
 * Only visible when username === 'test' (case-insensitive)
 */
export default function GlobalDebugMenu({ username }) {
  const [showMenu, setShowMenu] = useState(false)
  const debugContext = useContext(PopupDebugContext)

  if (!debugContext) return null

  const isTestUser = username === 'test' || username === 'Test'
  if (!isTestUser) return null

  const { triggerPopup, getRegisteredPopups } = debugContext
  const registeredPopups = getRegisteredPopups()

  const popupCategories = {
    'Logout Reminders': [
      { id: 'logout-popup-1', label: '1️⃣ Popup 1 (8:00 PM)', description: 'First logout reminder' },
      { id: 'logout-popup-2', label: '2️⃣ Popup 2 (8:15 PM)', description: 'Second logout reminder' },
      { id: 'logout-popup-3', label: '3️⃣ Popup 3 (8:30 PM)', description: 'Third logout reminder' },
    ],
    'Love Milestones': [
      { id: 'love-milestone-demo', label: '💕 Love Milestone', description: 'Show love milestone popup' },
      { id: 'love-special-reminder', label: '✨ Special Reminder', description: 'Show special reminder' },
    ],
    'Message Milestones': [
      { id: 'message-milestone-demo', label: '💬 Message Milestone', description: 'Show message milestone' },
    ],
    'Love Reminders': [
      { id: 'love-reminder-demo', label: '❤️ Love Reminder', description: 'Show love reminder popup' },
    ],
    'Check Notifications': [
      { id: 'checked-for-you-demo', label: '👀 Checked For You', description: 'Show checked notification' },
    ],
  }

  const handleTriggerPopup = (popupId) => {
    triggerPopup(popupId)
    setShowMenu(false)
  }

  return (
    <div className="global-debug-menu-container">
      <button
        className="global-debug-menu-btn"
        onClick={() => setShowMenu(!showMenu)}
        title="Global Debug Menu - Trigger All Popups"
        aria-label="Global debug menu"
      >
        🧪
      </button>

      {showMenu && (
        <motion.div
          className="global-debug-menu"
          initial={{ opacity: 0, scale: 0.8, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: 10 }}
          transition={{ duration: 0.2 }}
        >
          <div className="global-debug-menu-header">
            <p className="global-debug-menu-title">🧪 All Popups</p>
            <button
              className="global-debug-menu-close"
              onClick={() => setShowMenu(false)}
              aria-label="Close menu"
            >
              ✕
            </button>
          </div>

          <div className="global-debug-menu-content">
            {Object.entries(popupCategories).map(([category, items]) => (
              <div key={category} className="global-debug-category">
                <p className="global-debug-category-title">{category}</p>
                {items.map((item) => (
                  <button
                    key={item.id}
                    className={`global-debug-trigger-btn ${
                      registeredPopups.includes(item.id) ? 'registered' : 'unregistered'
                    }`}
                    onClick={() => handleTriggerPopup(item.id)}
                    title={item.description}
                    disabled={!registeredPopups.includes(item.id)}
                  >
                    <span className="trigger-label">{item.label}</span>
                    {registeredPopups.includes(item.id) ? (
                      <span className="trigger-status">✓</span>
                    ) : (
                      <span className="trigger-status disabled">✗</span>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>

          <div className="global-debug-menu-footer">
            <p className="global-debug-footer-text">
              {registeredPopups.length} popups registered
            </p>
          </div>
        </motion.div>
      )}
    </div>
  )
}
