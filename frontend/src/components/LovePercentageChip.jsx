import './LovePercentageChip.css'

function calcPercentage(todayMessages, yesterdayMessages, dailyAverage) {
  const today = Math.max(0, Number(todayMessages || 0))
  const yesterday = Math.max(0, Number(yesterdayMessages || 0))
  const average = Math.max(0, Number(dailyAverage || 0))

  if (today === 0) return 0

  if (today >= yesterday && today >= average) return 100

  const ratios = []
  if (yesterday > 0) ratios.push(today / yesterday)
  if (average > 0) ratios.push(today / average)
  if (!ratios.length) return 100

  const blendedRatio = ratios.reduce((sum, value) => sum + value, 0) / ratios.length
  const computed = Math.round(blendedRatio * 100)
  return Math.max(0, Math.min(99, computed))
}

function getChipColor(pct) {
  if (pct >= 100) return '#ef4444'
  if (pct >= 95) return '#f97316'
  if (pct >= 90) return '#ec4899'
  if (pct >= 85) return '#e879f9'
  if (pct >= 80) return '#818cf8'
  return '#60a5fa'
}

function LovePercentageChip({ todayMessages, yesterdayMessages, dailyAverage }) {
  const pct = calcPercentage(
    Number(todayMessages || 0),
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
