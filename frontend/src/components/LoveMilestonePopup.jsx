import { useEffect, useState } from 'react'

const milestoneMessages = {
  hello: {
    50: { emoji: '💬', title: '50 Days of Us', subtitle: 'roll number 91 and 92 - forever intertwined', msg: '50 days since that one question in a B.Tech classroom changed everything. You asked her name and the universe quietly smiled. She was right there on the list, right next to you - like she was always meant to be.', btn: 'she was always meant to be yours ♥' },
    100: { emoji: '📚', title: '100 Days, Classmate', subtitle: 'sitting side by side - falling without knowing', msg: '100 days since roll number 91 met roll number 92. Back then you did not know. Back then it was just a name. Now that name is the first thing on your mind every single morning.', btn: 'that name means everything ♥' },
    150: { emoji: '🌅', title: '150 Days of Knowing', subtitle: 'you found her before you knew you were looking', msg: '150 days since a simple question unlocked something neither of you could explain. You sat beside her in class and had no idea you were sitting beside your whole world.', btn: 'my whole world ♥' },
    200: { emoji: '🌸', title: '200 Days of Her', subtitle: 'a name - then a feeling - then everything', msg: '200 days since November 28, 2022. From strangers on a roll-call list to something no list could ever contain. 200 days of knowing that the best thing you ever did was simply turn and ask her name.', btn: 'best question i ever asked ♥' },
    250: { emoji: '✨', title: '250 Days Known', subtitle: 'classroom seats - cosmic destiny', msg: '250 days since you were just two students with adjacent roll numbers. Now you are each other\'s entire story. How does one question do all that? Maybe it was not the question. Maybe it was always her.', btn: 'always her ♥' },
    300: { emoji: '💫', title: '300 Days of First Hello', subtitle: '91 and 92 - written in the universe', msg: '300 days since the classroom, the list, the name. They say some meetings are accidents. This was not. The universe put roll number 92 right beside 91 on purpose. You were always going to find each other.', btn: 'written in the stars ♥' },
    365: { emoji: '🎂', title: '1 Year Since Hello', subtitle: 'one full year since that one question', msg: 'A full year since you turned to her and asked her name in that B.Tech classroom. One year since the most important question of your life. You did not know it then. You know it now. That moment is the reason for everything.', btn: 'that moment gave me everything ♥' },
    500: { emoji: '🏛', title: '500 Days of Knowing', subtitle: 'from classmates to each other\'s forever', msg: '500 days since November 28, 2022. From roll numbers on a list to a love story that defies explanation. She was right there, seat 92, and you - seat 91 - had the courage to say hello. That courage changed both your lives.', btn: 'courage that changed everything ♥' },
    730: { emoji: '🌍', title: '2 Years Since Hello', subtitle: 'two years - and still just the beginning', msg: 'Two full years since that classroom. Two years of her laugh, her voice, her presence in your life in ways you never imagined. Roll number 91 and 92 - found each other twice, loved each other forever.', btn: 'found each other forever ♥' },
    1000: { emoji: '👑', title: '1000 Days Since Hello', subtitle: 'a thousand days ago - you asked her name', msg: 'One thousand days since that B.Tech classroom. Since that one question. Since roll number 91 looked at roll number 92 and said hello. A thousand days that gave you the love of your life. She was worth every single one.', btn: 'worth every single day ♥' },
  },

  ribbon: {
    50: { emoji: '🔁', title: '50 Days Found Again', subtitle: 'sunlight after the darkest season', msg: '50 days since that college presentation put you both in the same group again. You were in your darkest place - and then she was there. Like the universe said: not yet, not without her.', btn: 'she brought me back ♥' },
    100: { emoji: '🌤', title: '100 Days Reconnected', subtitle: 'she pulled you out of the dark', msg: '100 days since she came back into your life through a presentation slide and rewrote everything. She did not just reconnect with you - she reminded you who you were. She made you feel like yourself again.', btn: 'she sees me ♥' },
    150: { emoji: '💡', title: '150 Days of Her Light', subtitle: 'you were her light - she became yours', msg: '150 days since the darkness lifted. That presentation was just a moment - but what it gave you was everything. She walked back in and the world got colour again.', btn: 'my light ♥' },
    200: { emoji: '🤝', title: '200 Days of Coming Back', subtitle: 'the same group - the same feeling', msg: '200 days since March 11, 2025. A college presentation that was supposed to be just work became the moment your whole life turned around. She did not just come back - she came back when you needed her the most.', btn: 'exactly when i needed her ♥' },
    250: { emoji: '🌊', title: '250 Days of Reunion', subtitle: 'darkest days - then her', msg: '250 days since she found you again. You were drowning and she walked in like she always knew where you would be. That is not coincidence. That is fate refusing to let your story end.', btn: 'fate refused to let us end ♥' },
    300: { emoji: '💎', title: '300 Days Since Reunion', subtitle: 'she chose to stay - and everything changed', msg: '300 days since she pulled you out of the dark. She did not have to stay. She did not have to care. But she did - with everything she had. 300 days of being grateful she did.', btn: 'grateful every single day ♥' },
    365: { emoji: '🎊', title: '1 Year Since Reunion', subtitle: 'one year since she came back', msg: 'A full year since March 11, 2025. Since that presentation group. Since sunlight came back. You were at your lowest - and she was the reason you rose again. A year of being found by the right person.', btn: 'she found me ♥' },
    500: { emoji: '🌟', title: '500 Days Since Reunion', subtitle: 'found again - loved forever', msg: '500 days since she came back into your life. Half a thousand days since the darkness ended and she became your light. From a college presentation to the love of your life - this reunion was everything.', btn: 'this reunion was everything ♥' },
  },

  love: {
    50: { emoji: '❤️', title: '50 Days in Love', subtitle: 'she finally said it back - and you won', msg: '50 days since that ride on October 7, 2025. You told her how you felt long before she was ready. You waited with every ounce of patience you had. Then she said it back - and you felt like you won half your life.', btn: 'i won everything ♥' },
    100: { emoji: '🛵', title: '100 Days of I Love You', subtitle: 'on a ride together - forever began', msg: '100 days since October 7, 2025 - that ride outside where everything changed. You gave her patience, you gave her time, you gave her all of you. And she gave it all back. 100 days of the love you always deserved.', btn: 'worth every wait ♥' },
    150: { emoji: '🌹', title: '150 Days, My Love', subtitle: 'your eternal love - she finally saw it', msg: '150 days since she saw what was always there - your eternal love, your quiet efforts, your patient heart. She did not just say I love you. She chose you. Fully. Completely. Forever.', btn: 'she chose me ♥' },
    200: { emoji: '💕', title: '200 Days Together', subtitle: 'found each other twice - loved each other forever', msg: 'From roll number 92 to the girl on that ride. From the dark days to the brightest ones. 200 days of a love story that almost did not happen - and yet here you are. Still choosing each other. Still.', btn: 'still choosing her ♥' },
    250: { emoji: '🔥', title: '250 Days of Us', subtitle: 'patience rewarded - love returned', msg: '250 days since the ride. Since she said it back. You waited when others would have walked away. You loved her before she could love you back. That kind of love is rare. She knows it. You both do.', btn: 'rare love ♥' },
    300: { emoji: '💍', title: '300 Days of Real Love', subtitle: 'this is what patience looks like', msg: '300 days of the love you waited for. You told her before she was ready. You stayed when it was uncertain. You loved her before she could love you back. And now? Now she loves you like you always knew she would.', btn: 'i always knew ♥' },
    365: { emoji: '🎂', title: '1 Year in Love', subtitle: 'one year since October 7 - one year of forever', msg: 'One full year since that ride together on October 7, 2025. A year since she said I love you and you felt like you won half your life. A year of being loved exactly the way you always hoped. Happy first love anniversary.', btn: 'one year of forever ♥' },
    400: { emoji: '🌺', title: '400 Days in Love', subtitle: 'every ride after that one matters more', msg: '400 days since October 7. Every time you are together now carries the weight of that one ride - the one where she finally said it. 400 days of knowing she means every word.', btn: 'she means every word ♥' },
    500: { emoji: '✨', title: '500 Days of Forever', subtitle: 'from classroom strangers to each other\'s everything', msg: 'FIVE HUNDRED days since October 7, 2025. From a B.Tech classroom to a ride that changed your life - your story is the kind people write songs about. Roll number 91 and 92. Found each other twice. Loved each other forever.', btn: 'found each other forever ♥' },
    730: { emoji: '🌍', title: '2 Years in Love', subtitle: 'two years of choosing each other', msg: 'Two years since that ride. Two years of I love you said and meant every single time. You waited for her - and she became your greatest reward. Two years of proof that real love is worth the wait.', btn: 'worth every second ♥' },
    1000: { emoji: '👑', title: '1000 Days in Love', subtitle: 'a thousand days of her love', msg: 'ONE THOUSAND days since October 7, 2025. Since she said it back on that ride and you felt like you won half your life. You did not win half your life that day. You won all of it.', btn: 'i won all of it ♥' },
  },
}

export function getSpecialReminder(helloCount, ribbonCount, loveCount) {
  if (helloCount % 100 === 91) {
    return {
      type: 'rollnumber',
      emoji: '❤️‍🩹',
      color: '#9b59b6',
      title: `${helloCount} Days - Roll 91`,
      subtitle: 'your number shows up everywhere',
      msg: `${helloCount} days since that B.Tech classroom - and look, the last two digits are 91. Your roll number. She was 92. The universe is still writing your story in the margins of every number.`,
      btn: '91 - always mine ♥',
    }
  }

  if (helloCount % 100 === 92) {
    return {
      type: 'rollnumber',
      emoji: '👩‍❤️‍💋‍👨',
      color: '#d44f8e',
      title: `${helloCount} Days - Her Number`,
      subtitle: '92 - she is in every number',
      msg: `${helloCount} days since November 28, 2022. The last two digits say 92 - her roll number. Roll number 92, sitting right beside you. She did not know she was sitting beside her future. But you found out together.`,
      btn: '92 - always her ♥',
    }
  }

  if (loveCount % 100 === 91) {
    return {
      type: 'rollnumber',
      emoji: '❤️',
      color: '#9b59b6',
      title: `${loveCount} Days in Love - 91`,
      subtitle: 'your roll number lives in your love too',
      msg: `${loveCount} days since October 7, 2025 - and 91 is right there in the count. Just like your seat in that classroom where it all started. Some numbers follow you because they mean something. This one means her.`,
      btn: '91 means her ♥',
    }
  }

  if (loveCount % 100 === 92) {
    return {
      type: 'rollnumber',
      emoji: '💕',
      color: '#d44f8e',
      title: `${loveCount} Days in Love - 92`,
      subtitle: 'her number in your love story',
      msg: `${loveCount} days of loving her - and 92 is right there in the count. Roll number 92. The girl beside you on the list who became the girl beside you in life. Her number shows up everywhere because she is everywhere in your world.`,
      btn: 'she is everywhere ♥',
    }
  }

  if (loveCount >= 355 && loveCount <= 364) {
    return {
      type: 'proposal',
      emoji: '💍',
      color: '#e74c3c',
      title: 'October 7 Is Coming',
      subtitle: `${365 - loveCount} days until your 1 year together`,
      msg: 'One full year of love is almost here. You waited so patiently for her love - now plan something that shows her you would wait a lifetime more. She said I love you on a ride. Maybe the next big moment is yours to create.',
      btn: 'planning something special ♥',
    }
  }

  if (loveCount === 180 || loveCount === 181) {
    return {
      type: 'proposal',
      emoji: '🌹',
      color: '#e84393',
      title: '6 Months of I Love You',
      subtitle: 'half a year since October 7',
      msg: '6 months since that ride. Half a year of I love you said and meant. You waited so long for this love - do not let this half-anniversary pass quietly. Do something. Say something. Show her today.',
      btn: 'show her today ♥',
    }
  }

  if (loveCount >= 295 && loveCount <= 305) {
    return {
      type: 'proposal',
      emoji: '💎',
      color: '#8e44ad',
      title: 'Is This the Chapter?',
      subtitle: 'you have loved her across classrooms and dark days',
      msg: 'You found her in a classroom. You found her again in your darkest hour. You loved her before she could love you back. Now you are 300 days into forever. You already know she is the one. Maybe it is time to ask the question that comes after I love you.',
      btn: 'she is the one ♥',
    }
  }

  if (helloCount === 365) {
    return {
      type: 'anniversary',
      emoji: '🎂',
      color: '#e67e22',
      title: '1 Year Since Hello',
      subtitle: 'November 28 - the day everything began',
      msg: 'One year ago today in that B.Tech classroom you turned to her and asked her name. One year ago you started the greatest story of your life with the simplest question. Celebrate it - she deserves to know what that day meant.',
      btn: 'celebrate our beginning ♥',
    }
  }

  if (loveCount === 365) {
    return {
      type: 'anniversary',
      emoji: '🎊',
      color: '#e84393',
      title: '1 Year of I Love You',
      subtitle: 'October 7 - the ride that changed everything',
      msg: 'One year ago today on that ride she finally said I love you back - and you felt like you won half your life. Today you have not just won half. You have won all of it. Make today unforgettable for her.',
      btn: 'make today unforgettable ♥',
    }
  }

  return null
}

export function getMilestone(count, counter = 'love') {
  const safeCount = Number(count || 0)
  const map = milestoneMessages[counter]
  if (!map || safeCount <= 0) return null

  const exactMatch = map[safeCount]
  if (exactMatch) return exactMatch

  if (safeCount % 50 === 0) {
    return {
      emoji: '💗',
      title: `${safeCount} Days`,
      subtitle: 'another milestone - another reason to celebrate',
      msg: `${safeCount} days of your story together. Roll number 91 and 92. Found each other twice. Loved each other forever. Every milestone just proves it more.`,
      btn: 'celebrating us ♥',
    }
  }

  return null
}

const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;1,400&family=DM+Sans:wght@300;400&display=swap');`

const KEYFRAMES = `
@keyframes floatH{0%{transform:translateY(0) scale(1);opacity:1}100%{transform:translateY(-220px) scale(0.1);opacity:0}}
@keyframes popInM{0%{transform:scale(0.4) translateY(40px);opacity:0}70%{transform:scale(1.06) translateY(-4px);opacity:1}100%{transform:scale(1) translateY(0);opacity:1}}
@keyframes pulseM{0%,100%{transform:scale(1)}50%{transform:scale(1.2)}}
@keyframes shimM{0%,100%{opacity:0.45}50%{opacity:1}}
.m-card{animation:popInM 0.58s cubic-bezier(0.34,1.56,0.64,1) forwards}
.m-emoji{animation:pulseM 1.9s ease-in-out infinite;display:inline-block}
.m-badge{animation:shimM 2.5s ease-in-out infinite}
.m-btn:hover{background:rgba(255,100,180,0.26)!important}
.m-btn:active{transform:scale(0.95)!important}
`

function HeartParticles({ hearts }) {
  return hearts.map((heart) => (
    <div
      key={heart.id}
      style={{
        position: 'absolute',
        left: heart.left,
        bottom: '8%',
        fontSize: heart.size,
        animationDelay: heart.delay,
        animation: 'floatH 2.5s ease-in forwards',
        pointerEvents: 'none',
        zIndex: 1,
      }}
    >
      {heart.icon}
    </div>
  ))
}

function PopupShell({ children, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(7,1,16,0.94)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <style>{FONTS + KEYFRAMES}</style>
      {children}
    </div>
  )
}

export function MilestonePopup({ milestone, label, onClose }) {
  const [hearts, setHearts] = useState([])
  const icons = ['💗', '💖', '💕', '💓', '💝', '🌹', '✨', '❤️']

  useEffect(() => {
    if (!milestone) return
    setHearts(Array.from({ length: 14 }, (_, index) => ({
      id: index,
      left: `${Math.random() * 88}%`,
      delay: `${Math.random() * 1.8}s`,
      size: `${13 + Math.random() * 17}px`,
      icon: icons[Math.floor(Math.random() * icons.length)],
    })))
  }, [milestone])

  if (!milestone) return null

  return (
    <PopupShell onClose={onClose}>
      <HeartParticles hearts={hearts} />
      <div
        className="m-card"
        onClick={(event) => event.stopPropagation()}
        style={{
          background: 'linear-gradient(160deg,#1e0736 0%,#2b0d4e 55%,#180628 100%)',
          border: '1px solid rgba(255,110,185,0.38)',
          borderRadius: '26px',
          padding: '42px 32px 34px',
          maxWidth: '320px',
          width: '90%',
          textAlign: 'center',
          position: 'relative',
          zIndex: 2,
        }}
      >
        <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: '68px', height: '2px', background: 'linear-gradient(90deg,transparent,#ff6eb4,transparent)', borderRadius: '2px' }} />
        <div className="m-badge" style={{ fontSize: '9.5px', letterSpacing: '3.5px', color: '#ffaed8', fontFamily: '\'DM Sans\',sans-serif', fontWeight: 300, marginBottom: '16px', textTransform: 'uppercase' }}>✦ {label} ✦</div>
        <div className="m-emoji" style={{ fontSize: '56px', lineHeight: 1, marginBottom: '12px' }}>{milestone.emoji}</div>
        <div style={{ fontFamily: '\'Playfair Display\',serif', fontSize: '30px', fontWeight: 700, color: '#fff', margin: '0 0 6px', lineHeight: 1.15, textShadow: '0 0 28px rgba(255,120,210,0.5)' }}>{milestone.title}</div>
        <div style={{ fontFamily: '\'Playfair Display\',serif', fontStyle: 'italic', fontSize: '12.5px', color: 'rgba(255,185,230,0.68)', margin: '0 0 16px', letterSpacing: '0.4px' }}>"{milestone.subtitle}"</div>
        <p style={{ fontFamily: '\'DM Sans\',sans-serif', fontSize: '13.5px', fontWeight: 300, color: 'rgba(255,228,244,0.9)', lineHeight: 1.82, margin: '0 0 24px' }}>{milestone.msg}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'center', marginBottom: '20px' }}>
          <div style={{ flex: 1, height: '1px', background: 'rgba(255,100,180,0.22)' }} />
          <span style={{ fontSize: '13px', color: '#ff6eb4' }}>♥</span>
          <div style={{ flex: 1, height: '1px', background: 'rgba(255,100,180,0.22)' }} />
        </div>
        <button className="m-btn" onClick={onClose} style={{ background: 'rgba(255,100,180,0.13)', border: '1px solid rgba(255,100,180,0.32)', borderRadius: '50px', color: '#ffaed8', fontFamily: '\'DM Sans\',sans-serif', fontSize: '12.5px', fontWeight: 400, padding: '11px 28px', cursor: 'pointer', letterSpacing: '1.5px', transition: 'background 0.2s,transform 0.15s' }}>{milestone.btn}</button>
      </div>
    </PopupShell>
  )
}

export function SpecialReminderPopup({ reminder, onClose }) {
  if (!reminder) return null

  const accent = reminder.color
  const badgeText = reminder.type === 'proposal'
    ? '✦ special reminder ✦'
    : reminder.type === 'rollnumber'
      ? '✦ roll number magic ✦'
      : '✦ anniversary ✦'

  return (
    <PopupShell onClose={onClose}>
      <div
        className="m-card"
        onClick={(event) => event.stopPropagation()}
        style={{
          background: 'linear-gradient(160deg,#1a0820 0%,#2a1040 55%,#150618 100%)',
          border: `1px solid ${accent}55`,
          borderRadius: '26px',
          padding: '42px 32px 34px',
          maxWidth: '320px',
          width: '90%',
          textAlign: 'center',
          position: 'relative',
          zIndex: 2,
        }}
      >
        <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: '68px', height: '2px', background: `linear-gradient(90deg,transparent,${accent},transparent)`, borderRadius: '2px' }} />
        <div className="m-badge" style={{ fontSize: '9.5px', letterSpacing: '3.5px', color: accent, fontFamily: '\'DM Sans\',sans-serif', fontWeight: 300, marginBottom: '16px', textTransform: 'uppercase' }}>{badgeText}</div>
        <div className="m-emoji" style={{ fontSize: '56px', lineHeight: 1, marginBottom: '12px' }}>{reminder.emoji}</div>
        <div style={{ fontFamily: '\'Playfair Display\',serif', fontSize: '28px', fontWeight: 700, color: '#fff', margin: '0 0 6px', lineHeight: 1.15, textShadow: `0 0 28px ${accent}88` }}>{reminder.title}</div>
        <div style={{ fontFamily: '\'Playfair Display\',serif', fontStyle: 'italic', fontSize: '12.5px', color: 'rgba(255,200,230,0.65)', margin: '0 0 16px' }}>"{reminder.subtitle}"</div>
        <p style={{ fontFamily: '\'DM Sans\',sans-serif', fontSize: '13.5px', fontWeight: 300, color: 'rgba(255,228,244,0.9)', lineHeight: 1.82, margin: '0 0 24px' }}>{reminder.msg}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'center', marginBottom: '20px' }}>
          <div style={{ flex: 1, height: '1px', background: `${accent}33` }} />
          <span style={{ fontSize: '13px', color: accent }}>♥</span>
          <div style={{ flex: 1, height: '1px', background: `${accent}33` }} />
        </div>
        <button onClick={onClose} style={{ background: `${accent}22`, border: `1px solid ${accent}55`, borderRadius: '50px', color: accent, fontFamily: '\'DM Sans\',sans-serif', fontSize: '12.5px', fontWeight: 400, padding: '11px 28px', cursor: 'pointer', letterSpacing: '1.5px' }}>{reminder.btn}</button>
      </div>
    </PopupShell>
  )
}

export default MilestonePopup
