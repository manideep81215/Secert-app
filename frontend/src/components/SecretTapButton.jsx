import { useEffect, useMemo, useRef } from 'react'
import { toast } from 'react-toastify'
import tapIcon from '../assets/secret-tap-icon.png'
import './SecretTapButton.css'

const SECRET_TAP_TYPE = 'secret-tap'
const SECRET_TAP_WINDOW_MS = 320
const SECRET_TAP_LONG_PRESS_MS = 2000
const TONY_USERNAME = 'tony'
const SECRET_TAP_TARGETS = {
  tony: ['hihi', 'test'],
  hihi: ['tony'],
  test: ['tony'],
}
const SECRET_TAP_MESSAGES = {
  1: 'Wait ,Ostha',
  2: 'amma nanna unnaru',
  3: "can't stay Bye Good Night Baby",
}
const TONY_LONG_PRESS_MESSAGE = 'Aagu baby Ostha ,Avvatle matladadam'

const normalizeUsername = (value) => String(value || '').trim().toLowerCase()

function SecretTapButton({ username, socketRef }) {
  const tapCountRef = useRef(0)
  const tapTimerRef = useRef(null)
  const longPressTimerRef = useRef(null)
  const isSendingRef = useRef(false)
  const suppressNextClickRef = useRef(false)
  const normalizedUsername = normalizeUsername(username)
  const isTonySender = normalizedUsername === TONY_USERNAME

  const recipients = useMemo(() => {
    const mapped = SECRET_TAP_TARGETS[normalizedUsername] || []
    return Array.from(new Set(mapped.map((value) => normalizeUsername(value)).filter(Boolean)))
  }, [normalizedUsername])

  const canUseSecretTap = recipients.length > 0

  const clearTapTimer = () => {
    if (tapTimerRef.current) {
      clearTimeout(tapTimerRef.current)
      tapTimerRef.current = null
    }
  }

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const sendSecretTapMessage = async ({ text, tempKey, successToast }) => {
    const activeSocket = socketRef?.current

    if (!text || !recipients.length) return
    if (!activeSocket?.connected) {
      toast.error('Secret tap is offline right now.')
      return
    }
    if (isSendingRef.current) return

    isSendingRef.current = true
    try {
      const senderUsername = String(username || '').trim()
      const timestamp = Date.now()

      recipients.forEach((toUsername, index) => {
        activeSocket.publish({
          destination: '/app/chat.send',
          body: JSON.stringify({
            toUsername,
            message: text,
            fromUsername: senderUsername,
            tempId: `secret-tap-${tempKey}-${timestamp}-${index}`,
            type: SECRET_TAP_TYPE,
          }),
        })
      })

      if (successToast) {
        toast.success(successToast)
      }
    } finally {
      isSendingRef.current = false
    }
  }

  const resolveTapSequence = (tapCount) => {
    tapCountRef.current = 0
    clearTapTimer()
    const successToast = `You clicked ${tapCount} ${tapCount === 1 ? 'time' : 'times'}`
    if (isTonySender) {
      toast.success(successToast)
      return
    }
    void sendSecretTapMessage({
      text: SECRET_TAP_MESSAGES[tapCount],
      tempKey: `tap-${tapCount}`,
      successToast,
    })
  }

  const handleClick = () => {
    if (!canUseSecretTap) return
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false
      return
    }

    const nextTapCount = Math.min(3, Number(tapCountRef.current || 0) + 1)
    tapCountRef.current = nextTapCount

    clearTapTimer()

    if (nextTapCount >= 3) {
      resolveTapSequence(3)
      return
    }

    tapTimerRef.current = setTimeout(() => {
      resolveTapSequence(nextTapCount)
    }, SECRET_TAP_WINDOW_MS)
  }

  const handlePointerDown = (event) => {
    if (!isTonySender || !canUseSecretTap) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    suppressNextClickRef.current = false
    clearLongPressTimer()
    longPressTimerRef.current = setTimeout(() => {
      suppressNextClickRef.current = true
      clearTapTimer()
      tapCountRef.current = 0
      void sendSecretTapMessage({
        text: TONY_LONG_PRESS_MESSAGE,
        tempKey: 'long-press',
        successToast: 'Long Pressed Successfully',
      })
    }, SECRET_TAP_LONG_PRESS_MS)
  }

  const handlePointerEnd = () => {
    if (!isTonySender) return
    clearLongPressTimer()
  }

  useEffect(() => () => {
    clearTapTimer()
    clearLongPressTimer()
  }, [])

  if (!canUseSecretTap) return null

  return (
    <button
      type="button"
      className="secret-tap-btn"
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerEnd}
      onPointerLeave={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      aria-label={isTonySender ? 'Hold to send hidden message' : 'Send hidden tap message'}
      title={isTonySender ? 'Hold for 2 seconds to send hidden message' : 'Send hidden tap message'}
    >
      <img src={tapIcon} alt="" className="secret-tap-btn-icon" aria-hidden="true" />
    </button>
  )
}

export default SecretTapButton
