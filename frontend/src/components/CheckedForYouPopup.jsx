import { useEffect, useState, useContext, useRef } from 'react'
import { PopupDebugContext } from '../context/PopupDebugContext'

function CheckedForYouPopup({ checkerUsername, checkCount, onDismiss }) {
  const [visible, setVisible] = useState(false)
  const debugContext = useContext(PopupDebugContext)
  const debugShowRef = useRef(false)

  // Trigger function for debug menu
  const debugTriggerChecked = () => {
    setVisible(true)
    debugShowRef.current = true
    const timer = window.setTimeout(() => {
      setVisible(false)
      window.setTimeout(() => onDismiss?.(), 300)
    }, 4000)
    return () => window.clearTimeout(timer)
  }

  // Register debug function
  useEffect(() => {
    if (!debugContext) return
    debugContext.registerDebugFunction('checked-for-you-demo', debugTriggerChecked)
  }, [debugContext])

  useEffect(() => {
    if (!checkerUsername || !checkCount) {
      if (!debugShowRef.current) {
        setVisible(false)
      }
      return undefined
    }
    debugShowRef.current = false
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
