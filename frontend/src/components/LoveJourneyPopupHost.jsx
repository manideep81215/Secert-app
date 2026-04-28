import { useEffect, useRef, useState } from 'react'
import LoveJourneyMilestonePopup, {
  SpecialReminderPopup,
  getMilestone,
  getSpecialReminder,
} from './LoveMilestonePopup'
import { FIRST_TALK, FOUND_AGAIN, LOVE_START, getElapsed } from '../lib/loveJourney'

const LOVE_DAY_MILESTONE_STORAGE_KEY = 'love_timers_day_milestone_v1'
const LOVE_SPECIAL_REMINDER_STORAGE_KEY = 'love_timers_special_reminder_v1'
const TIMER_SYNC_MS = 60 * 1000

const COUNTER_CONFIG = [
  { counter: 'hello', counterKey: 'since_first_hello', label: 'since first hello' },
  { counter: 'ribbon', counterKey: 'since_reunion', label: 'since reunion' },
  { counter: 'love', counterKey: 'days_in_love', label: 'days in love' },
]

function buildDayMilestoneStorageKey(counterKey, count) {
  return `${LOVE_DAY_MILESTONE_STORAGE_KEY}:${counterKey}:${count}`
}

function wasDayMilestoneCelebrated(counterKey, count) {
  try {
    return window.localStorage.getItem(buildDayMilestoneStorageKey(counterKey, count)) === '1'
  } catch {
    return false
  }
}

function markDayMilestoneCelebrated(counterKey, count) {
  try {
    window.localStorage.setItem(buildDayMilestoneStorageKey(counterKey, count), '1')
  } catch {
    // Ignore storage failures.
  }
}

function buildSpecialReminderStorageKey(queueKey) {
  return `${LOVE_SPECIAL_REMINDER_STORAGE_KEY}:${queueKey}`
}

function wasSpecialReminderCelebrated(queueKey) {
  try {
    return window.localStorage.getItem(buildSpecialReminderStorageKey(queueKey)) === '1'
  } catch {
    return false
  }
}

function markSpecialReminderCelebrated(queueKey) {
  try {
    window.localStorage.setItem(buildSpecialReminderStorageKey(queueKey), '1')
  } catch {
    // Ignore storage failures.
  }
}

function getCurrentTimerCounts() {
  return {
    hello: getElapsed(FIRST_TALK).totalDays,
    ribbon: getElapsed(FOUND_AGAIN).totalDays,
    love: getElapsed(LOVE_START).totalDays,
  }
}

export default function LoveJourneyPopupHost() {
  const [timerCounts, setTimerCounts] = useState(() => getCurrentTimerCounts())
  const [popupQueue, setPopupQueue] = useState([])
  const [activePopup, setActivePopup] = useState(null)
  const queuedPopupKeysRef = useRef(new Set())

  useEffect(() => {
    const syncTimerCounts = () => {
      setTimerCounts((prev) => {
        const next = getCurrentTimerCounts()
        if (
          prev.hello === next.hello &&
          prev.ribbon === next.ribbon &&
          prev.love === next.love
        ) {
          return prev
        }
        return next
      })
    }

    syncTimerCounts()
    const intervalId = window.setInterval(syncTimerCounts, TIMER_SYNC_MS)
    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    if (activePopup || popupQueue.length === 0) return
    setActivePopup(popupQueue[0])
    setPopupQueue((prev) => prev.slice(1))
  }, [activePopup, popupQueue])

  const enqueuePopup = (popup) => {
    if (!popup?.queueKey || queuedPopupKeysRef.current.has(popup.queueKey)) return
    queuedPopupKeysRef.current.add(popup.queueKey)
    setPopupQueue((prev) => [...prev, popup])
  }

  useEffect(() => {
    COUNTER_CONFIG.forEach(({ counter, counterKey, label }) => {
      const count = Number(timerCounts[counter] || 0)
      const milestone = getMilestone(count, counter)
      if (!milestone || wasDayMilestoneCelebrated(counterKey, count)) return

      enqueuePopup({
        kind: 'milestone',
        milestone,
        counterKey,
        label,
        count,
        queueKey: `${counterKey}:${count}`,
      })
    })
  }, [timerCounts.hello, timerCounts.ribbon, timerCounts.love])

  useEffect(() => {
    const helloCount = Number(timerCounts.hello || 0)
    const ribbonCount = Number(timerCounts.ribbon || 0)
    const loveCount = Number(timerCounts.love || 0)
    if (helloCount <= 0 || ribbonCount <= 0 || loveCount <= 0) return

    const reminder = getSpecialReminder(helloCount, ribbonCount, loveCount)
    if (!reminder) return

    const queueKey = `special:${helloCount}:${ribbonCount}:${loveCount}:${String(reminder.type || '')}:${String(reminder.title || '')}`
    if (wasSpecialReminderCelebrated(queueKey)) return

    enqueuePopup({
      kind: 'special',
      reminder,
      queueKey,
    })
  }, [timerCounts.hello, timerCounts.ribbon, timerCounts.love])

  const dismissActivePopup = () => {
    if (!activePopup) return

    if (activePopup.kind === 'milestone') {
      markDayMilestoneCelebrated(activePopup.counterKey, activePopup.count)
    } else if (activePopup.kind === 'special') {
      markSpecialReminderCelebrated(activePopup.queueKey)
    }

    queuedPopupKeysRef.current.delete(activePopup.queueKey)
    setActivePopup(null)
  }

  return (
    <>
      <LoveJourneyMilestonePopup
        milestone={activePopup?.kind === 'milestone' ? activePopup.milestone : null}
        label={activePopup?.kind === 'milestone' ? activePopup.label : ''}
        onClose={dismissActivePopup}
      />
      <SpecialReminderPopup
        reminder={activePopup?.kind === 'special' ? activePopup.reminder : null}
        onClose={dismissActivePopup}
      />
    </>
  )
}
