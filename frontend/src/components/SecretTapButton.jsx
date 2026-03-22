import { useEffect, useMemo, useRef } from 'react'
import { toast } from 'react-toastify'
import tapIcon from '../assets/secret-tap-icon.png'
import './SecretTapButton.css'

const SECRET_TAP_TYPE = 'secret-tap'
const SECRET_TAP_WINDOW_MS = 320
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

const normalizeUsername = (value) => String(value || '').trim().toLowerCase()

function SecretTapButton({ username, socketRef }) {
  const tapCountRef = useRef(0)
  const tapTimerRef = useRef(null)
  const isSendingRef = useRef(false)

  const recipients = useMemo(() => {
    const senderKey = normalizeUsername(username)
    const mapped = SECRET_TAP_TARGETS[senderKey] || []
    return Array.from(new Set(mapped.map((value) => normalizeUsername(value)).filter(Boolean)))
  }, [username])

  const canUseSecretTap = recipients.length > 0

  const sendSecretTapMessage = async (tapCount) => {
    const activeSocket = socketRef?.current
    const text = SECRET_TAP_MESSAGES[tapCount]

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
            tempId: `secret-tap-${timestamp}-${tapCount}-${index}`,
            type: SECRET_TAP_TYPE,
          }),
        })
      })

      toast.success(`You clicked ${tapCount} ${tapCount === 1 ? 'time' : 'times'}`)
    } finally {
      isSendingRef.current = false
    }
  }

  const resolveTapSequence = (tapCount) => {
    tapCountRef.current = 0
    if (tapTimerRef.current) {
      clearTimeout(tapTimerRef.current)
      tapTimerRef.current = null
    }
    void sendSecretTapMessage(tapCount)
  }

  const handleClick = () => {
    if (!canUseSecretTap) return

    const nextTapCount = Math.min(3, Number(tapCountRef.current || 0) + 1)
    tapCountRef.current = nextTapCount

    if (tapTimerRef.current) {
      clearTimeout(tapTimerRef.current)
      tapTimerRef.current = null
    }

    if (nextTapCount >= 3) {
      resolveTapSequence(3)
      return
    }

    tapTimerRef.current = setTimeout(() => {
      resolveTapSequence(nextTapCount)
    }, SECRET_TAP_WINDOW_MS)
  }

  useEffect(() => () => {
    if (tapTimerRef.current) {
      clearTimeout(tapTimerRef.current)
      tapTimerRef.current = null
    }
  }, [])

  if (!canUseSecretTap) return null

  return (
    <button
      type="button"
      className="secret-tap-btn"
      onClick={handleClick}
      aria-label="Send hidden tap message"
      title="Send hidden tap message"
    >
      <img src={tapIcon} alt="" className="secret-tap-btn-icon" aria-hidden="true" />
    </button>
  )
}

export default SecretTapButton
