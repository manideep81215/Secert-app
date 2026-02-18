import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ToastContainer } from 'react-toastify'
import AuthPage from './pages/AuthPage'
import GamesPage from './pages/GamesPage'
import RpsGamePage from './pages/RpsGamePage'
import CoinGamePage from './pages/CoinGamePage'
import TttGamePage from './pages/TttGamePage'
import VerifyPage from './pages/VerifyPage'
import UsersListPage from './pages/UsersListPage'
import ChatPageNew from './pages/ChatPageNew'
import ProfilePage from './pages/ProfilePage'
import './App.css'

const pageMotion = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -18 },
  transition: { duration: 0.22 },
}

function App() {
  const location = useLocation()
  const [installPromptEvent, setInstallPromptEvent] = useState(null)
  const [isAppInstalled, setIsAppInstalled] = useState(false)
  const isFullBleedRoute =
    location.pathname === '/auth' ||
    location.pathname.startsWith('/games') ||
    location.pathname === '/profile' ||
    location.pathname === '/verify' ||
    location.pathname === '/users' ||
    location.pathname === '/chat'

  useEffect(() => {
    const checkInstalled = () => {
      const standalone = window.matchMedia?.('(display-mode: standalone)').matches
      const iosStandalone = window.navigator.standalone === true
      setIsAppInstalled(Boolean(standalone || iosStandalone))
    }

    const onBeforeInstallPrompt = (event) => {
      event.preventDefault()
      setInstallPromptEvent(event)
      checkInstalled()
    }

    const onAppInstalled = () => {
      setInstallPromptEvent(null)
      setIsAppInstalled(true)
    }

    checkInstalled()
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [])

  const handleInstall = async () => {
    if (!installPromptEvent) return
    installPromptEvent.prompt()
    const result = await installPromptEvent.userChoice
    if (result?.outcome !== 'accepted') return
    setInstallPromptEvent(null)
  }

  return (
    <div className={`app-wrap container-fluid ${isFullBleedRoute ? 'app-auth-route p-0' : 'py-4 px-3 px-md-4'}`}>
      <div className={isFullBleedRoute ? 'app-auth-max' : 'mx-auto app-max'}>
        <AnimatePresence mode="wait">
          <motion.div key={location.pathname} {...pageMotion}>
            <Routes>
              <Route path="/" element={<Navigate to="/auth" replace />} />
              <Route path="/auth" element={<AuthPage />} />
              <Route path="/games" element={<GamesPage />} />
              <Route path="/games/rps" element={<RpsGamePage />} />
              <Route path="/games/coin" element={<CoinGamePage />} />
              <Route path="/games/ttt" element={<TttGamePage />} />
              <Route path="/verify" element={<VerifyPage />} />
              <Route path="/users" element={<UsersListPage />} />
              <Route path="/chat" element={<ChatPageNew />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="*" element={<Navigate to="/auth" replace />} />
            </Routes>
          </motion.div>
        </AnimatePresence>
      </div>

      {!isAppInstalled && installPromptEvent && (
        <button className="pwa-install-btn" onClick={handleInstall} aria-label="Install app">
          Install App
        </button>
      )}

      <ToastContainer position="bottom-left" autoClose={1800} hideProgressBar />
    </div>
  )
}

export default App
