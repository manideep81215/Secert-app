import computerChoiceSoundUrl from '../assets/sounds/freesound_community-coin-flip-37787.mp3'

let computerChoiceAudio = null

function getComputerChoiceAudio() {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return null
  if (computerChoiceAudio) return computerChoiceAudio
  const audio = new Audio(computerChoiceSoundUrl)
  audio.preload = 'auto'
  audio.volume = 0.9
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
      // Ignore autoplay/runtime audio failures.
    })
  }
}

