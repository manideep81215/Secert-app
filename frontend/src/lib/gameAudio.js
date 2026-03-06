import computerChoiceSoundUrl from '../assets/sounds/freesound_community-coin-flip-37787.mp3'

let computerChoiceAudio = null

function getComputerChoiceAudio() {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return null
  if (computerChoiceAudio) return computerChoiceAudio
  const audio = new Audio(computerChoiceSoundUrl)
  audio.preload = 'auto'
  audio.playsInline = true
  audio.muted = false
  audio.volume = 0.9
  try {
    audio.load()
  } catch {
    // Ignore eager preload failures.
  }
  computerChoiceAudio = audio
  return computerChoiceAudio
}

export function playComputerChoiceSound() {
  const audio = getComputerChoiceAudio()
  if (!audio) return
  try {
    audio.currentTime = 0
  } catch {
    // Ignore seek reset errors.
  }
  const playPromise = audio.play()
  if (playPromise?.catch) {
    playPromise.catch(() => {
      // Fallback: create a fresh audio instance for stricter Android WebViews.
      try {
        const fallback = new Audio(computerChoiceSoundUrl)
        fallback.preload = 'auto'
        fallback.playsInline = true
        fallback.muted = false
        fallback.volume = 0.9
        const fallbackPromise = fallback.play()
        fallbackPromise?.catch?.(() => {})
      } catch {
        // Ignore autoplay/runtime audio failures.
      }
    })
  }
}
