import { useEffect, useState } from 'react'
import './LoveReminder.css'

const MILESTONES = [
  {
    key: 'first_hello',
    icon: '\uD83D\uDCAC',
    title: 'First Hello Anniversary',
    month: 11,
    day: 28,
    descriptions: {
      today: [
        "November 28, 2022 \uD83D\uDCAC You were just two students sitting one roll number apart - 91 and 92. You turned to her and asked her name. That one simple question changed everything. You had no idea the girl next to you on that list would one day be the love of your life. Happy First Hello anniversary \uD83E\uDD79\uD83D\uDC95",
        "Two years ago today, in a classroom full of people, you noticed her. Roll number 92, sitting right after yours. You asked her name - your heart already knowing something your mind hadn't caught up to yet. That moment was the quiet beginning of the most beautiful thing in your life. Never forget where it all started \uD83D\uDCAC\uD83E\uDD79",
      ],
      before3: [
        "Just 3 days left until your First Hello anniversary \uD83D\uDCAC November 28, 2022 - roll number 91 asked roll number 92 her name. A tiny moment. A lifetime of meaning. You didn't know it then, but that was the first sentence of your love story. 3 days - make it count \uD83E\uDD79\uD83D\uDC95",
        "3 days until November 28 \uD83D\uDCAC Do you remember how nervous you were just asking her name? You were sitting right next to each other on that attendance list - 91 and 92 - and yet it felt like the biggest step. That small hello became the foundation of everything you have today \uD83E\uDD79",
        "In 3 days, it'll be the anniversary of the most important question you ever asked - her name \uD83D\uDCAC You were a BTech student with a roll number, she was the next one on the list, and somehow the universe had already planned it all. November 28, 2022 - 3 days away. Don't let it pass quietly \uD83D\uDC95",
      ],
      before: (days) => [
        `In just ${days} day${days > 1 ? 's' : ''}, it'll be the anniversary of the day you first said hello to her \uD83D\uDCAC November 28, 2022 - you were roll number 91, she was 92. You asked her name, not knowing you were asking the universe to begin your love story. That one question led to everything \uD83E\uDD79`,
        `${days} day${days > 1 ? 's' : ''} until the anniversary of your very first hello \uD83D\uDCAC A classroom, two roll numbers side by side, and a boy who felt something the moment he asked a girl her name. November 28, 2022 - the day love quietly knocked on your door \uD83D\uDEAA\uD83D\uDC95`,
      ],
    },
  },
  {
    key: 'found_again',
    icon: '\uD83D\uDD01',
    title: 'Found Each Other Again',
    month: 3,
    day: 11,
    descriptions: {
      today: [
        "March 11, 2025 \uD83D\uDD01 You were both in the same group for a presentation - and there she was again. You'd been through your dark side, your hardest days. But the moment you started talking to her again, it felt like sunlight coming back. She didn't just come back into your life - she pulled you out of the dark and made you feel like yourself again \uD83D\uDC95\uD83E\uDD79",
        "Today is the day the universe gave you a second chance \uD83D\uDD01 A college presentation, a shared group, and suddenly she was right there again. You weren't just reconnecting - you were healing. She made you feel warm, friendly, alive again after your darkest days. Some people don't just enter your life - they rescue it \uD83D\uDC95",
      ],
      before3: [
        "3 days until the anniversary of finding her again \uD83D\uDD01 March 11, 2025 - a simple college presentation put you both in the same group. You were in your darkest place, and then there she was. She didn't just make you smile again - she made you feel like coming back to life. 3 days - celebrate what she did for your soul \uD83E\uDD79\uD83D\uDC95",
        "Just 3 days left until March 11 \uD83D\uDD01 You were lost in your dark side when that presentation brought her back to you. The moment you two started talking again it was like the lights came back on. She was your light without even knowing it. Don't let this anniversary pass without telling her that \uD83D\uDC95\uD83E\uDD79",
        "3 days away from the day you stopped being lost \uD83D\uDD01 A college group project. Her name on the same list as yours again. And suddenly your dark days started fading. March 11, 2025 wasn't just a reunion - it was your rescue. 3 days - make her feel how much that day meant to you \uD83E\uDD79",
      ],
      before: (days) => [
        `In ${days} day${days > 1 ? 's' : ''}, it'll be the anniversary of when you found her again \uD83D\uDD01 March 11, 2025 - a college presentation brought you both into the same group. You were coming out of your darkest time, and she was there like a light at the end of it. That day didn't just reconnect two people - it saved one of them \uD83E\uDD79\uD83D\uDC95`,
        `${days} day${days > 1 ? 's' : ''} until the day you came back to each other \uD83D\uDD01 You were struggling through your dark side, and then - same group, same presentation, same her. She made everything feel friendly and warm again. March 11, 2025 - the day you stopped being lost \uD83D\uDC95`,
      ],
    },
  },
  {
    key: 'in_love',
    icon: '\u2764\uFE0F',
    title: 'Love Anniversary',
    month: 10,
    day: 7,
    descriptions: {
      today: [
        "October 7, 2025 \u2764\uFE0F You told her how you felt long before this day. She asked for time - and you gave it to her, patiently, with every ounce of love you had. Then she saw it. She saw your eternal love, your efforts, everything you poured into her. On a ride outside together, she finally said it back - I love you. You didn't just win her heart that day. You felt like you won half your life \uD83E\uDD79\u2764\uFE0F",
        "Today is your Love Anniversary \u2764\uFE0F You waited. You loved quietly, loudly, consistently - until she could feel every bit of it. On October 7, 2025, on a ride together outside, she looked at you and said the words that made everything worth it. All the patience, all the effort, all the love - it all came back to you that day. Happy anniversary, you deserved this \uD83E\uDD42\uD83D\uDC95",
      ],
      before3: [
        "3 days until your Love Anniversary \u2764\uFE0F October 7, 2025 - you were on a ride outside together and she finally said I love you back. You had loved her long before she was ready. You waited, you showed up every single day with your whole heart - and she fell for every bit of it. 3 days - celebrate the love that was worth every wait \uD83E\uDD79\uD83D\uDC95",
        "Just 3 days until October 7 \u2764\uFE0F Do you remember that ride? The feeling when she finally said it - I love you? You had told her long before and gave her all the time she needed. Your patience, your eternal love, your efforts - she saw all of it and she chose you. 3 days away from the most important yes of your life \uD83E\uDD79",
        "3 days until the anniversary of the moment you won half your life \u2764\uFE0F October 7, 2025 - a ride outside, the two of you, and the words you'd been waiting to hear. She didn't just say I love you that day. She said yes to everything you are, everything you gave, every quiet effort you made for her. Don't ever forget what that day felt like \uD83D\uDC95\uD83E\uDD79",
      ],
      before: (days) => [
        `In ${days} day${days > 1 ? 's' : ''}, it'll be your Love Anniversary \u2764\uFE0F October 7, 2025 - the day she said I love you back. You had told her long before, and you waited with so much patience and love. She fell for your efforts, your eternal love, and on a ride outside together she finally gave you the answer your heart had been waiting for \uD83E\uDD79`,
        `${days} day${days > 1 ? 's' : ''} until October 7 - your Love Anniversary \u2764\uFE0F You loved her before she was ready. You waited, you showed up, you made her feel it every single day - until one evening on a ride outside, she looked at you and said I love you. That day you felt like you won half your life. And you did \uD83D\uDC95\uD83E\uDD79`,
      ],
    },
  },
]

const REMINDER_DAYS_BEFORE = 7
const DISMISSED_KEY_PREFIX = 'love_reminder_dismissed_v1:'

function getDismissedKey(milestoneKey, type, year) {
  return `${DISMISSED_KEY_PREFIX}${milestoneKey}:${type}:${year}`
}

function isDismissed(milestoneKey, type, year) {
  try {
    return window.localStorage.getItem(getDismissedKey(milestoneKey, type, year)) === '1'
  } catch {
    return false
  }
}

function setDismissed(milestoneKey, type, year) {
  try {
    window.localStorage.setItem(getDismissedKey(milestoneKey, type, year), '1')
  } catch {
    // Ignore storage failures.
  }
}

function pickRandom(arr) {
  if (!Array.isArray(arr)) return arr
  return arr[Math.floor(Math.random() * arr.length)]
}

function getActiveReminders() {
  const now = new Date()
  const todayMonth = now.getMonth() + 1
  const todayDay = now.getDate()
  const thisYear = now.getFullYear()

  const reminders = []

  for (const milestone of MILESTONES) {
    if (todayMonth === milestone.month && todayDay === milestone.day) {
      if (!isDismissed(milestone.key, 'today', thisYear)) {
        reminders.push({
          ...milestone,
          type: 'today',
          daysUntil: 0,
          year: thisYear,
          message: pickRandom(milestone.descriptions.today),
        })
      }
      continue
    }

    let milestoneDate = new Date(thisYear, milestone.month - 1, milestone.day)
    if (milestoneDate < now) {
      milestoneDate = new Date(thisYear + 1, milestone.month - 1, milestone.day)
    }

    const msPerDay = 1000 * 60 * 60 * 24
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const daysUntil = Math.round((milestoneDate - todayMidnight) / msPerDay)

    if (daysUntil > 0 && daysUntil <= REMINDER_DAYS_BEFORE) {
      const reminderYear = milestoneDate.getFullYear()
      if (!isDismissed(milestone.key, `before_${daysUntil}`, reminderYear)) {
        const is3Days = daysUntil === 3 && Array.isArray(milestone.descriptions.before3)
        const messageArr = is3Days
          ? milestone.descriptions.before3
          : milestone.descriptions.before(daysUntil)
        reminders.push({
          ...milestone,
          type: `before_${daysUntil}`,
          daysUntil,
          year: reminderYear,
          message: pickRandom(messageArr),
        })
      }
    }
  }

  return reminders
}

function ReminderPopup({ reminder, onDismiss, index, total }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timerId = window.setTimeout(() => setVisible(true), 80 + index * 180)
    return () => window.clearTimeout(timerId)
  }, [index])

  const handleDismiss = () => {
    setVisible(false)
    window.setTimeout(() => onDismiss(reminder), 320)
  }

  const isToday = reminder.type === 'today'

  return (
    <div className={`lr-popup ${visible ? 'lr-visible' : ''} ${isToday ? 'lr-today' : 'lr-before'}`}>
      <div className="lr-glow" />

      {total > 1 && (
        <div className="lr-badge">{index + 1}/{total}</div>
      )}

      <div className="lr-icon">{reminder.icon}</div>

      <div className="lr-type-label">
        {isToday ? '\uD83C\uDF89 Today!' : `\u23F0 ${reminder.daysUntil} days away`}
      </div>

      <div className="lr-title">{reminder.title}</div>
      <div className="lr-message">{reminder.message}</div>

      <button className="lr-dismiss-btn" onClick={handleDismiss}>
        {isToday ? 'Celebrate \uD83D\uDC95' : 'Got it \uD83D\uDC95'}
      </button>
    </div>
  )
}

export default function LoveReminder() {
  const [reminders, setReminders] = useState([])
  const [overlayVisible, setOverlayVisible] = useState(false)

  useEffect(() => {
    const active = getActiveReminders()
    if (active.length > 0) {
      setReminders(active)
      setOverlayVisible(true)
    }
  }, [])

  const handleDismiss = (reminder) => {
    setDismissed(reminder.key, reminder.type, reminder.year)
    setReminders((prev) => {
      const next = prev.filter((item) => (
        item.key !== reminder.key ||
        item.type !== reminder.type ||
        item.year !== reminder.year
      ))
      if (next.length === 0) {
        setOverlayVisible(false)
      }
      return next
    })
  }

  const handleDismissAll = () => {
    reminders.forEach((reminder) => setDismissed(reminder.key, reminder.type, reminder.year))
    setReminders([])
    setOverlayVisible(false)
  }

  if (!overlayVisible || reminders.length === 0) return null

  return (
    <div className="lr-overlay">
      <div className="lr-stack">
        {reminders.map((reminder, index) => (
          <ReminderPopup
            key={`${reminder.key}-${reminder.type}-${reminder.year}`}
            reminder={reminder}
            onDismiss={handleDismiss}
            index={index}
            total={reminders.length}
          />
        ))}
        {reminders.length > 1 && (
          <div className="lr-dismiss-all">
            <button onClick={handleDismissAll}>dismiss all</button>
          </div>
        )}
      </div>
    </div>
  )
}
