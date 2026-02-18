import axios from 'axios'

export async function getModeReply(mode, messageText) {
  if (mode === 'strategy') {
    const { data } = await axios.get('https://api.quotable.io/random', { timeout: 6000 })
    return data?.content || `Nice move: ${messageText}`
  }

  if (mode === 'fortune') {
    const { data } = await axios.get('https://api.adviceslip.com/advice', { timeout: 6000 })
    return data?.slip?.advice || 'Fortune says keep smiling.'
  }

  const lines = [
    'You are my favorite player.',
    'You make every level better.',
    'Date night MVP unlocked.',
    'I like this secret place with you.',
  ]

  return lines[Math.floor(Math.random() * lines.length)]
}
