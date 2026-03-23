import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './InstagramReelPage.css'

function InstagramReelPage() {
  const navigate = useNavigate()
  const popupRef = useRef(null)
  const [opened, setOpened] = useState(false)

  const openInstagram = () => {
    const popup = window.open(
      'https://www.instagram.com/',
      'instagram',
      `width=${window.screen.width},height=${window.screen.height},top=0,left=0,fullscreen=yes`,
    )
    popupRef.current = popup
    setOpened(Boolean(popup && !popup.closed))
  }

  useEffect(() => {
    openInstagram()
    return () => {
      if (popupRef.current && !popupRef.current.closed) {
        popupRef.current.close()
      }
    }
  }, [])

  const handleBack = () => {
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.close()
    }
    navigate(-1)
  }

  const handleGames = () => {
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.close()
    }
    navigate('/games')
  }

  return (
    <div className="instagram-reel-page">
      <div className="instagram-reel-navbar">
        <button type="button" className="instagram-reel-btn" onClick={handleBack}>
          Back
        </button>
        <button type="button" className="instagram-reel-btn" onClick={handleGames}>
          Games
        </button>
      </div>

      <div className="instagram-reel-content">
        {!opened ? (
          <button type="button" className="instagram-open-btn" onClick={openInstagram}>
            Open Instagram
          </button>
        ) : (
          <p className="instagram-reel-hint">Instagram opened above ↑</p>
        )}
      </div>
    </div>
  )
}

export default InstagramReelPage
