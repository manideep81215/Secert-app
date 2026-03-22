import { useEffect, useMemo, useRef } from 'react'
import { toast } from 'react-toastify'
import tapIcon from '../assets/secret-tap-icon.png'
import './SecretTapButton.css'

const SECRET_TAP_TYPE = 'secret-tap'
const SECRET_TAP_WINDOW_MS = 320
const SECRET_TAP_LONG_PRESS_MS = 2000
const TONY_USERNAME = 'tony'
const HIHI_USERNAME = 'hihi'
const SECRET_TAP_TARGETS = {
  tony: ['hihi', 'test'],
  hihi: ['tony'],
  test: ['tony'],
}
const SECRET_TAP_MESSAGES = {
  1: 'Wait , Ostha',
  2: 'amma nanna unnaru',
  3: "can't stay Bye Good Night",
}
const TONY_LONG_PRESS_MESSAGE = 'Aagu baby Ostha ,Avvatle matladadam'
const HIHI_LONG_PRESS_MESSAGE = 'Hari unnadu'

const normalizeUsername = (value) => String(value || '').trim().toLowerCase()

function SecretTapButton({ username, socketRef }) {
  const tapCountRef = useRef(0)
  const tapTimerRef = useRef(null)
  const longPressTimerRef = useRef(null)
  const isSendingRef = useRef(false)
  const suppressNextClickRef = useRef(false)
  const normalizedUsername = normalizeUsername(username)
  const isTonySender = normalizedUsername === TONY_USERNAME
  const isHihiSender = normalizedUsername === HIHI_USERNAME
  const supportsExtendedTapCount = isTonySender || isHihiSender
  const longPressMessage = isTonySender
    ? TONY_LONG_PRESS_MESSAGE
    : (isHihiSender ? HIHI_LONG_PRESS_MESSAGE : '')
  const hasLongPressMessage = Boolean(longPressMessage)

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
      toast.error('Button Clicking Not Wokring! Wait for 5 sec and try')
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

  const buildTapMessageText = (tapCount) => {
    const safeTapCount = Math.max(1, Number(tapCount || 0))
    if (safeTapCount <= 1) return SECRET_TAP_MESSAGES[1]
    if (safeTapCount === 2) return SECRET_TAP_MESSAGES[2]
    if (safeTapCount === 3) return SECRET_TAP_MESSAGES[3]
    if (isHihiSender) {
      return `${SECRET_TAP_MESSAGES[3]} (${safeTapCount} taps)`
    }
    return SECRET_TAP_MESSAGES[3]
  }

  const resolveTapSequence = (tapCount) => {
    tapCountRef.current = 0
    clearTapTimer()
    const safeTapCount = Math.max(1, Number(tapCount || 0))
    const successToast = `You clicked ${safeTapCount} ${safeTapCount === 1 ? 'time' : 'times'}`
    if (isTonySender) {
      toast.success(successToast)
      return
    }
    void sendSecretTapMessage({
      text: buildTapMessageText(safeTapCount),
      tempKey: `tap-${safeTapCount}`,
      successToast,
    })
  }

  const handleClick = () => {
    if (!canUseSecretTap) return
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false
      return
    }

    const nextTapCount = supportsExtendedTapCount
      ? Number(tapCountRef.current || 0) + 1
      : Math.min(3, Number(tapCountRef.current || 0) + 1)
    tapCountRef.current = nextTapCount

    clearTapTimer()

    if (!supportsExtendedTapCount && nextTapCount >= 3) {
      resolveTapSequence(3)
      return
    }

    tapTimerRef.current = setTimeout(() => {
      resolveTapSequence(nextTapCount)
    }, SECRET_TAP_WINDOW_MS)
  }

  const handlePointerDown = (event) => {
    if (!hasLongPressMessage || !canUseSecretTap) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    suppressNextClickRef.current = false
    clearLongPressTimer()
    longPressTimerRef.current = setTimeout(() => {
      suppressNextClickRef.current = true
      clearTapTimer()
      tapCountRef.current = 0
      void sendSecretTapMessage({
        text: longPressMessage,
        tempKey: `${normalizedUsername}-long-press`,
        successToast: 'You Long Pressed The Button',
      })
    }, SECRET_TAP_LONG_PRESS_MS)
  }

  const handlePointerEnd = () => {
    if (!hasLongPressMessage) return
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
      aria-label={hasLongPressMessage ? 'Tap or hold to send hidden message' : 'Send hidden tap message'}
      title={hasLongPressMessage ? 'Tap normally or hold for 2 seconds for the special message' : 'Send hidden tap message'}
    >
      <img src={tapIcon} alt="" className="secret-tap-btn-icon" aria-hidden="true" />
    </button>
  )
}

export default SecretTapButton
