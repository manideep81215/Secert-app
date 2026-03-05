import { useEffect, useRef, useState } from 'react'

export default function PrivacyBlur() {
  const [blurred, setBlurred] = useState(false)
  const resumeTimerRef = useRef(null)

  useEffect(() => {
    const clearResumeTimer = () => {
      if (!resumeTimerRef.current) return
      window.clearTimeout(resumeTimerRef.current)
      resumeTimerRef.current = null
    }

    const blurNow = () => {
      clearResumeTimer()
      setBlurred(true)
    }

    const unblurSoon = () => {
      clearResumeTimer()
      resumeTimerRef.current = window.setTimeout(() => {
        setBlurred(false)
        resumeTimerRef.current = null
      }, 400)
    }

    const handleVisibility = () => {
      if (document.hidden) {
        blurNow()
        return
      }
      unblurSoon()
    }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('pagehide', blurNow)
    window.addEventListener('pageshow', unblurSoon)
    window.addEventListener('blur', blurNow)
    window.addEventListener('focus', unblurSoon)

    return () => {
      clearResumeTimer()
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('pagehide', blurNow)
      window.removeEventListener('pageshow', unblurSoon)
      window.removeEventListener('blur', blurNow)
      window.removeEventListener('focus', unblurSoon)
    }
  }, [])

  if (!blurred) return null

  return (
    <>
      <style>{`
        .pb-overlay {
          position: fixed;
          inset: 0;
          z-index: 99999;
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          background: rgba(8, 6, 16, 0.55);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.8rem;
          animation: pb-in 0.08s ease forwards;
        }

        @keyframes pb-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .pb-icon {
          font-size: 2.8rem;
          filter: drop-shadow(0 4px 16px rgba(255, 107, 157, 0.5));
          animation: pb-pulse 1.5s ease infinite;
        }

        .pb-logo {
          width: 72px;
          height: 72px;
          object-fit: contain;
          display: block;
        }

        @keyframes pb-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.12); }
        }

        .pb-text {
          font-family: -apple-system, sans-serif;
          font-size: 0.78rem;
          font-weight: 500;
          color: rgba(255, 200, 220, 0.45);
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
      `}</style>

      <div className="pb-overlay">
        <div className="pb-icon" aria-hidden="true">
          <img className="pb-logo" src="/theme/simp-games-quest-logo.png" alt="" />
        </div>
        <div className="pb-text">Simp-Games-Quest</div>
      </div>
    </>
  )
}
