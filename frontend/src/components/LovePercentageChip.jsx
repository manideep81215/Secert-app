import './LovePercentageChip.css'

function calcPercentage(yesterdayMessages, dailyAverage) {
  if (!dailyAverage || dailyAverage === 0) {
    const now = new Date()
    const seed = now.getFullYear() * 10000
      + (now.getMonth() + 1) * 100
      + now.getDate()
    return 85 + (Math.abs(seed * 2654435761) % 16)
  }
  const ratio = yesterdayMessages / dailyAverage
  const raw = Math.round(Math.min(ratio * 90, 100))
  return Math.max(raw, 70)
}

function getChipColor(pct) {
  if (pct >= 100) return '#ef4444'
  if (pct >= 95) return '#f97316'
  if (pct >= 90) return '#ec4899'
  if (pct >= 85) return '#e879f9'
  if (pct >= 80) return '#818cf8'
  return '#60a5fa'
}

function LovePercentageChip({ yesterdayMessages, dailyAverage }) {
  const pct = calcPercentage(
    Number(yesterdayMessages || 0),
    Number(dailyAverage || 0)
  )
  const color = getChipColor(pct)

  return (
    <div className="love-chip" style={{ '--love-chip-color': color }}>
      <div className="love-chip-row">
        <span className="love-chip-heart" aria-hidden="true">{'\uD83D\uDC95'}</span>
        <span className="love-chip-label">{`${pct}% today`}</span>
      </div>
      <div className="love-chip-bar" aria-hidden="true">
        <span className="love-chip-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
    </div>
  )
}

export default LovePercentageChip
