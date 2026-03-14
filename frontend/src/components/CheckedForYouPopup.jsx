import { useEffect, useState } from 'react'

function CheckedForYouPopup({ checkerUsername, checkCount, onDismiss }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!checkerUsername || !checkCount) {
      setVisible(false)
      return undefined
    }
    setVisible(true)
    const timer = window.setTimeout(() => {
      setVisible(false)
      window.setTimeout(() => onDismiss?.(), 300)
    }, 4000)
    return () => window.clearTimeout(timer)
  }, [checkerUsername, checkCount, onDismiss])

  if (!checkerUsername || !checkCount) return null

  const handleClick = () => {
    setVisible(false)
    window.setTimeout(() => onDismiss?.(), 300)
  }

  return (
    <div
      className={`checked-toast ${visible ? 'checked-toast-visible' : ''}`}
      onClick={handleClick}
    >
      <span className="checked-toast-eye">👀</span>
      <span className="checked-toast-text">
        <strong>@{checkerUsername}</strong> checked for you{' '}
        <strong>{checkCount} {checkCount === 1 ? 'time' : 'times'}</strong>
      </span>
    </div>
  )
}

export default CheckedForYouPopup
