import { useEffect, useState } from 'react'

function CheckedForYouPopup({ checkerUsername, checkCount, onDismiss }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!checkerUsername || !checkCount) {
      setVisible(false)
      return undefined
    }
    const timerId = window.setTimeout(() => setVisible(true), 70)
    return () => window.clearTimeout(timerId)
  }, [checkerUsername, checkCount])

  if (!checkerUsername || !checkCount) return null

  const handleDismiss = () => {
    setVisible(false)
    window.setTimeout(() => {
      onDismiss?.()
    }, 260)
  }

  return (
    <div className="checked-modal-overlay" role="dialog" aria-modal="true" aria-label="Checked for you">
      <div className={`checked-modal-card ${visible ? 'checked-modal-visible' : ''}`}>
        <div className="checked-modal-glow" />
        <div className="checked-modal-icon" aria-hidden="true">👀</div>
        <div className="checked-modal-kicker">Someone kept coming back</div>
        <div className="checked-modal-title">@{checkerUsername} checked for you</div>
        <div className="checked-modal-count">
          {checkCount} {checkCount === 1 ? 'time' : 'times'}
        </div>
        <div className="checked-modal-message">
          They opened your chat again and again before finally replying.
        </div>
        <button type="button" className="checked-modal-button" onClick={handleDismiss}>
          Aww, okay
        </button>
      </div>
    </div>
  )
}

export default CheckedForYouPopup
