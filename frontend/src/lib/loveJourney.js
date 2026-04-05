export const FIRST_TALK = new Date('2022-11-28T00:00:00')
export const TALKED_UNTIL = new Date('2023-03-24T00:00:00')
export const FOUND_AGAIN = new Date('2025-03-11T00:00:00')
export const LOVE_START = new Date('2025-10-07T00:00:00')

export function getElapsed(since) {
  const sinceMs = since instanceof Date ? since.getTime() : new Date(since).getTime()
  if (!Number.isFinite(sinceMs)) {
    return { years: 0, months: 0, days: 0, hours: 0, minutes: 0, seconds: 0, totalDays: 0 }
  }

  const now = Date.now()
  const diff = Math.max(0, now - sinceMs)
  const totalSeconds = Math.floor(diff / 1000)
  const totalMinutes = Math.floor(totalSeconds / 60)
  const totalHours = Math.floor(totalMinutes / 60)
  const totalDays = Math.floor(totalHours / 24)
  const totalYears = Math.floor(totalDays / 365.25)
  const years = totalYears
  const months = Math.floor((totalDays - years * 365.25) / 30.4375)
  const days = Math.floor(totalDays - years * 365.25 - months * 30.4375)

  return {
    years,
    months,
    days,
    hours: totalHours % 24,
    minutes: totalMinutes % 60,
    seconds: totalSeconds % 60,
    totalDays,
  }
}

export function getDaysBetween(a, b) {
  const fromMs = a instanceof Date ? a.getTime() : new Date(a).getTime()
  const toMs = b instanceof Date ? b.getTime() : new Date(b).getTime()
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return 0
  return Math.max(0, Math.floor((toMs - fromMs) / (1000 * 60 * 60 * 24)))
}
