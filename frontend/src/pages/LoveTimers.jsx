import { useEffect, useMemo, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

const FIRST_TALK  = new Date('2022-11-28T00:00:00')
const FOUND_AGAIN = new Date('2025-03-11T00:00:00')
const LOVE_START  = new Date('2025-10-07T00:00:00')
const LOVE_TIMERS_SECRET_CODE = String(import.meta.env.VITE_LOVE_TIMERS_SECRET_CODE || '9192').trim()

function getElapsed(since) {
  const now = new Date()
  const diff = now - since
  const totalSeconds = Math.floor(diff / 1000)
  const totalMinutes = Math.floor(totalSeconds / 60)
  const totalHours   = Math.floor(totalMinutes / 60)
  const totalDays    = Math.floor(totalHours / 24)
  const totalYears   = Math.floor(totalDays / 365.25)
  const years  = totalYears
  const months = Math.floor((totalDays - years * 365.25) / 30.4375)
  const days   = Math.floor(totalDays - years * 365.25 - months * 30.4375)
  return { years, months, days, hours: totalHours % 24, minutes: totalMinutes % 60, seconds: totalSeconds % 60, totalDays }
}

function getDaysBetween(a, b) {
  return Math.floor((b - a) / (1000 * 60 * 60 * 24))
}

function FloatingHeart({ style }) {
  return <div className="os-float-heart" style={style}>{'\uD83D\uDC95'}</div>
}

function TimerUnit({ value, label, accent }) {
  const [prev, setPrev] = useState(value)
  const [flip, setFlip] = useState(false)
  useEffect(() => {
    if (value === prev) return
    setFlip(true)
    const t = setTimeout(() => { setPrev(value); setFlip(false) }, 280)
    return () => clearTimeout(t)
  }, [value, prev])
  return (
    <div className="os-tu">
      <div className={`os-tu-val ${flip ? 'os-flip' : ''}`} style={{ '--acc': accent }}>
        <span>{String(value).padStart(2, '0')}</span>
      </div>
      <div className="os-tu-label">{label}</div>
    </div>
  )
}

function TimerCard({ title, subtitle, story, detail, icon, since, accent, glow, tag, delay, index }) {
  const [elapsed, setElapsed]   = useState(() => getElapsed(since))
  const [visible, setVisible]   = useState(false)
  const [expanded, setExpanded] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const t  = setTimeout(() => setVisible(true), delay)
    const iv = setInterval(() => setElapsed(getElapsed(since)), 1000)
    return () => { clearTimeout(t); clearInterval(iv) }
  }, [since, delay])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setVisible(true); obs.disconnect() }
    }, { threshold: 0.12 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const isLeft = index % 2 === 0

  return (
    <div ref={ref} className={`os-timeline-item ${isLeft ? 'os-left' : 'os-right'} ${visible ? 'os-item-visible' : ''}`}>
      <div className="os-dot" style={{ background: accent, boxShadow: `0 0 0 4px ${glow}, 0 0 20px ${glow}` }}>
        <span className="os-dot-icon">{icon}</span>
      </div>
      <div className="os-card" style={{ '--acc': accent, '--glow': glow }}>
        <div className="os-card-glow" />
        <div className="os-card-shimmer" />
        <div className="os-tag" style={{ color: accent, borderColor: `${accent}44`, background: `${accent}11` }}>{tag}</div>
        <div className="os-card-head">
          <span className="os-card-icon">{icon}</span>
          <div>
            <div className="os-card-title">{title}</div>
            <div className="os-card-subtitle">{subtitle}</div>
          </div>
        </div>
        <div className="os-days-row">
          <span className="os-days-num" style={{ color: accent }}>{elapsed.totalDays.toLocaleString()}</span>
          <span className="os-days-word">days</span>
        </div>
        <div className="os-timer-grid">
          {elapsed.years  > 0 && <TimerUnit value={elapsed.years}   label="yrs" accent={accent} />}
          {elapsed.months > 0 && <TimerUnit value={elapsed.months}  label="mos" accent={accent} />}
          <TimerUnit value={elapsed.days}    label="days" accent={accent} />
          <TimerUnit value={elapsed.hours}   label="hrs"  accent={accent} />
          <TimerUnit value={elapsed.minutes} label="min"  accent={accent} />
          <TimerUnit value={elapsed.seconds} label="sec"  accent={accent} />
        </div>
        <div className={`os-story ${expanded ? 'os-story-open' : ''}`}><p>{story}</p></div>
        <button className="os-read-btn" onClick={() => setExpanded(p => !p)} style={{ color: accent }}>
          {expanded ? '\u2191 less' : '\u2193 read more'}
        </button>
        <div className="os-card-detail">
          <span className="os-detail-dot" style={{ background: accent }} />
          {detail}
        </div>
      </div>
    </div>
  )
}

function GapCard({ from, to, label }) {
  const [visible, setVisible] = useState(false)
  const ref = useRef(null)
  const days   = getDaysBetween(from, to)
  const years  = Math.floor(days / 365)
  const months = Math.floor((days % 365) / 30)
  const dur    = years > 0
    ? `${years}y ${months > 0 ? months + 'm' : ''}`
    : `${months} month${months !== 1 ? 's' : ''}`

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setVisible(true); obs.disconnect() }
    }, { threshold: 0.3 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  return (
    <div ref={ref} className={`os-gap ${visible ? 'os-gap-visible' : ''}`}>
      <div className="os-gap-line" />
      <div className="os-gap-pill">
        <span className="os-gap-dur">{dur}</span>
        <span className="os-gap-lbl">{label}</span>
      </div>
      <div className="os-gap-line" />
    </div>
  )
}

function StatsBar() {
  const [vis, setVis] = useState(false)
  useEffect(() => { const t = setTimeout(() => setVis(true), 400); return () => clearTimeout(t) }, [])

  const stats = [
    { label: 'Since First Hello', value: getElapsed(FIRST_TALK).totalDays.toLocaleString(),  icon: '\uD83D\uDCAC', color: '#c084fc' },
    { label: 'Since Reunion',     value: getElapsed(FOUND_AGAIN).totalDays.toLocaleString(), icon: '\uD83D\uDD01', color: '#ff8fab' },
    { label: 'Days In Love',      value: getElapsed(LOVE_START).totalDays.toLocaleString(),  icon: '\u2764\uFE0F', color: '#ff6b9d' },
    { label: 'Days Apart',        value: getDaysBetween(FIRST_TALK, FOUND_AGAIN).toLocaleString(), icon: '\uD83C\uDF19', color: '#60a5fa' },
  ]

  return (
    <div className={`os-stats ${vis ? 'os-stats-vis' : ''}`}>
      {stats.map((s, i) => (
        <div key={i} className="os-stat" style={{ animationDelay: `${i * 100}ms` }}>
          <div className="os-stat-icon">{s.icon}</div>
          <div className="os-stat-num" style={{ color: s.color }}>{s.value}</div>
          <div className="os-stat-lbl">{s.label}</div>
        </div>
      ))}
    </div>
  )
}

function SecretGate({ onUnlock }) {
  const [code, setCode]   = useState('')
  const [error, setError] = useState('')
  const [shake, setShake] = useState(false)

  const submit = (e) => {
    e.preventDefault()
    if (String(code).trim() === LOVE_TIMERS_SECRET_CODE) {
      onUnlock()
    } else {
      setError('Wrong code \uD83D\uDC94')
      setShake(true)
      setTimeout(() => setShake(false), 500)
    }
  }

  return (
    <div className="os-gate">
      <div className="os-gate-icon">{'\uD83D\uDD12'}</div>
      <div className="os-gate-title">Our Secret Space</div>
      <p className="os-gate-sub">Enter your secret code to open our story {'\uD83D\uDC95'}</p>
      <form onSubmit={submit} className={`os-gate-form ${shake ? 'os-shake' : ''}`}>
        <input
          className="os-gate-input"
          type="password"
          value={code}
          onChange={e => { setCode(e.target.value); setError('') }}
          placeholder="Secret code"
          autoComplete="off"
          autoFocus
        />
        <button className="os-gate-btn" type="submit">Open {'\uD83D\uDC95'}</button>
      </form>
      {error && <p className="os-gate-error">{error}</p>}
    </div>
  )
}

export default function LoveTimers() {
  const navigate  = useNavigate()
  const [unlocked, setUnlocked] = useState(false)

  const hearts = useMemo(() => Array.from({ length: 14 }, () => ({
    left:              `${Math.random() * 100}%`,
    animationDelay:    `${Math.random() * 10}s`,
    animationDuration: `${7 + Math.random() * 7}s`,
    fontSize:          `${0.7 + Math.random() * 1.1}rem`,
    opacity:           0.08 + Math.random() * 0.18,
  })), [])

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400;1,700&family=DM+Sans:wght@300;400;500;600&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

        .os-page {
          min-height: 100dvh;
          background: #080610;
          font-family: 'DM Sans', 'Segoe UI Emoji', 'Noto Color Emoji', 'Apple Color Emoji', sans-serif;
          position: relative;
          overflow-x: hidden;
        }

        .os-page::before {
          content:'';
          position:fixed;inset:0;
          background:
            radial-gradient(ellipse at 10% 15%, rgba(192,132,252,.08) 0%, transparent 45%),
            radial-gradient(ellipse at 90% 40%, rgba(255,107,157,.07) 0%, transparent 45%),
            radial-gradient(ellipse at 50% 85%, rgba(200,60,120,.05)  0%, transparent 40%);
          pointer-events:none;z-index:0;
        }

        .os-float-heart {
          position:fixed;bottom:-2rem;
          animation:os-float linear infinite;
          pointer-events:none;user-select:none;z-index:0;
        }
        @keyframes os-float {
          0%  {transform:translateY(0) rotate(-8deg) scale(.8);opacity:0}
          8%  {opacity:1}
          92% {opacity:.4}
          100%{transform:translateY(-110vh) rotate(10deg) scale(1.1);opacity:0}
        }

        .os-back {
          position:fixed;top:1rem;left:1rem;z-index:100;
          border:1px solid rgba(255,255,255,.1);
          background:rgba(255,255,255,.06);
          color:rgba(255,255,255,.7);
          border-radius:999px;padding:.4rem 1rem;
          font-size:.82rem;font-family:'DM Sans',sans-serif;
          cursor:pointer;backdrop-filter:blur(8px);
          transition:all .2s ease;
        }
        .os-back:hover{background:rgba(255,255,255,.13);color:#fff}
        .os-float-heart,.os-dot-icon,.os-card-icon,.os-stat-icon,.os-gate-icon,.os-footer-heart{
          font-family:'Segoe UI Emoji','Noto Color Emoji','Apple Color Emoji',sans-serif;
        }

        .os-wrap {
          position:relative;z-index:1;
          max-width:680px;margin:0 auto;
          padding:5rem 1.2rem 4rem;
        }

        .os-header {
          text-align:center;margin-bottom:2.5rem;
          animation:os-fade-down .8s ease forwards;opacity:0;
        }
        @keyframes os-fade-down {
          from{opacity:0;transform:translateY(-18px)}
          to{opacity:1;transform:translateY(0)}
        }
        .os-eyebrow {
          font-size:.68rem;font-weight:600;letter-spacing:.18em;
          text-transform:uppercase;color:rgba(255,180,210,.4);margin-bottom:.5rem;
        }
        .os-header h1 {
          font-family:'Playfair Display',serif;
          font-size:clamp(2.4rem,8vw,3.8rem);
          font-weight:700;color:#fff;line-height:1.05;letter-spacing:-.02em;
        }
        .os-header h1 span {
          background:linear-gradient(135deg,#ff6b9d,#ff8fab,#ffb3c6,#c084fc);
          -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
        }
        .os-header-sub {
          margin-top:.7rem;
          font-family:'Playfair Display','Segoe UI Emoji','Noto Color Emoji','Apple Color Emoji',serif;font-style:italic;
          font-size:1rem;color:rgba(255,200,220,.38);letter-spacing:.04em;
        }

        .os-stats {
          display:grid;grid-template-columns:repeat(2,1fr);
          gap:.6rem;margin-bottom:3rem;
          opacity:0;transition:opacity .6s ease;
        }
        .os-stats-vis{opacity:1}
        .os-stat {
          background:rgba(255,255,255,.04);
          border:1px solid rgba(255,255,255,.06);
          border-radius:16px;padding:.9rem .8rem;
          text-align:center;
          animation:os-pop .5s ease both;
        }
        @keyframes os-pop{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:scale(1)}}
        .os-stat-icon{font-size:1.3rem;margin-bottom:.3rem}
        .os-stat-num{font-family:'Playfair Display',serif;font-size:1.5rem;font-weight:700;line-height:1}
        .os-stat-lbl{font-size:.62rem;color:rgba(255,255,255,.28);text-transform:uppercase;letter-spacing:.08em;margin-top:.2rem}

        .os-timeline{position:relative;display:flex;flex-direction:column}
        .os-timeline::before {
          content:'';position:absolute;left:50%;top:0;bottom:0;
          width:1px;transform:translateX(-50%);
          background:linear-gradient(to bottom,transparent 0%,rgba(192,132,252,.2) 15%,rgba(255,107,157,.2) 50%,rgba(192,132,252,.2) 85%,transparent 100%);
        }

        .os-timeline-item {
          position:relative;width:50%;
          opacity:0;
          transition:opacity .6s ease, transform .6s cubic-bezier(.16,1,.3,1);
        }
        .os-left  {align-self:flex-start;transform:translateX(-28px);padding-right:2.8rem;padding-bottom:2.5rem}
        .os-right {align-self:flex-end;  transform:translateX(28px); padding-left:2.8rem; padding-bottom:2.5rem}
        .os-item-visible{opacity:1;transform:translateX(0)!important}

        .os-dot {
          position:absolute;width:2.6rem;height:2.6rem;
          border-radius:50%;display:grid;place-items:center;
          top:.5rem;z-index:2;
        }
        .os-left  .os-dot{right:-1.3rem}
        .os-right .os-dot{left:-1.3rem}
        .os-dot-icon{font-size:1.1rem;filter:drop-shadow(0 2px 4px rgba(0,0,0,.4))}

        .os-card {
          background:rgba(255,255,255,.04);
          border:1px solid rgba(255,255,255,.07);
          border-radius:20px;padding:1.4rem 1.2rem;
          position:relative;overflow:hidden;
          box-shadow:0 16px 40px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.05);
        }
        .os-card-glow {
          position:absolute;top:-50%;left:-20%;width:140%;height:140%;
          background:radial-gradient(ellipse,var(--glow) 0%,transparent 65%);
          opacity:.15;pointer-events:none;
        }
        .os-card-shimmer {
          position:absolute;top:0;left:-100%;width:55%;height:100%;
          background:linear-gradient(90deg,transparent,rgba(255,255,255,.025),transparent);
          animation:os-shimmer 5s ease infinite;
        }
        @keyframes os-shimmer{0%{left:-100%}50%,100%{left:200%}}

        .os-tag {
          display:inline-block;font-size:.6rem;font-weight:600;
          letter-spacing:.1em;text-transform:uppercase;
          border:1px solid;border-radius:999px;
          padding:.16rem .55rem;margin-bottom:.7rem;
          position:relative;z-index:1;
        }

        .os-card-head{display:flex;align-items:flex-start;gap:.6rem;margin-bottom:.85rem;position:relative;z-index:1}
        .os-card-icon{font-size:1.5rem;flex-shrink:0;filter:drop-shadow(0 3px 8px var(--glow))}
        .os-card-title{font-family:'Playfair Display',serif;font-size:1.1rem;font-weight:700;color:#fff;line-height:1.1}
        .os-card-subtitle{font-size:.7rem;color:rgba(255,200,220,.38);font-weight:300;letter-spacing:.06em;text-transform:uppercase;margin-top:.12rem}

        .os-days-row{display:flex;align-items:baseline;gap:.3rem;margin-bottom:.85rem;position:relative;z-index:1}
        .os-days-num{font-family:'Playfair Display',serif;font-size:clamp(2rem,7vw,2.8rem);font-weight:700;line-height:1;letter-spacing:-.03em;filter:drop-shadow(0 0 14px var(--glow))}
        .os-days-word{font-size:.8rem;color:rgba(255,255,255,.28);font-weight:300;letter-spacing:.08em;text-transform:uppercase}

        .os-timer-grid{display:flex;gap:.3rem;flex-wrap:wrap;margin-bottom:.9rem;position:relative;z-index:1}
        .os-tu{display:flex;flex-direction:column;align-items:center;gap:.12rem;flex:1;min-width:32px}
        .os-tu-val{
          background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.07);
          border-radius:7px;width:100%;padding:.35rem .15rem;
          text-align:center;font-size:.95rem;font-weight:500;color:var(--acc);
        }
        .os-flip{animation:os-flip-anim .28s ease}
        @keyframes os-flip-anim{
          0%{transform:translateY(0);opacity:1}
          35%{transform:translateY(-5px);opacity:0}
          65%{transform:translateY(5px);opacity:0}
          100%{transform:translateY(0);opacity:1}
        }
        .os-tu-label{font-size:.55rem;color:rgba(255,255,255,.22);text-transform:uppercase;letter-spacing:.07em}

        .os-story{font-size:.8rem;line-height:1.6;color:rgba(255,220,235,.55);font-weight:300;max-height:2.6rem;overflow:hidden;transition:max-height .4s ease;position:relative;z-index:1}
        .os-story-open{max-height:14rem}
        .os-read-btn{border:none;background:transparent;font-size:.7rem;cursor:pointer;padding:.18rem 0;font-family:'DM Sans',sans-serif;font-weight:500;position:relative;z-index:1;margin-bottom:.7rem;display:block}

        .os-card-detail{display:flex;align-items:center;gap:.35rem;font-size:.68rem;color:rgba(255,255,255,.18);border-top:1px solid rgba(255,255,255,.05);padding-top:.65rem;font-style:italic;font-family:'Playfair Display',serif;position:relative;z-index:1}
        .os-detail-dot{width:5px;height:5px;border-radius:50%;flex-shrink:0}

        .os-gap{display:flex;align-items:center;gap:.7rem;padding:.4rem 0 1.4rem;opacity:0;transform:scaleX(.8);transition:opacity .5s ease,transform .5s ease;position:relative;z-index:1}
        .os-gap-visible{opacity:1;transform:scaleX(1)}
        .os-gap-line{flex:1;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.07),transparent)}
        .os-gap-pill{flex-shrink:0;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:999px;padding:.28rem .85rem;text-align:center}
        .os-gap-dur{display:block;font-size:.75rem;font-weight:600;color:rgba(255,255,255,.3)}
        .os-gap-lbl{display:block;font-size:.6rem;color:rgba(255,255,255,.16);text-transform:uppercase;letter-spacing:.08em;margin-top:.08rem}

        .os-footer{text-align:center;padding:2.5rem 0 1rem;animation:os-fade-up 1s .4s ease both;opacity:0}
        @keyframes os-fade-up{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        .os-footer-heart{font-size:2rem;margin-bottom:.6rem;animation:os-hb 1.5s ease infinite;display:block}
        @keyframes os-hb{0%,100%{transform:scale(1)}30%{transform:scale(1.22)}}
        .os-footer-quote{font-family:'Playfair Display','Segoe UI Emoji','Noto Color Emoji','Apple Color Emoji',serif;font-style:italic;font-size:1rem;color:rgba(255,180,200,.28);line-height:1.6}
        .os-footer-quote span{color:rgba(255,180,200,.52)}

        .os-gate{display:flex;flex-direction:column;align-items:center;text-align:center;gap:.6rem;animation:os-fade-down .7s ease both}
        .os-gate-icon{font-size:3rem;margin-bottom:.4rem}
        .os-gate-title{font-family:'Playfair Display',serif;font-size:1.8rem;font-weight:700;color:#fff}
        .os-gate-sub{font-size:.85rem;color:rgba(255,200,220,.4);font-weight:300;margin-bottom:.5rem}
        .os-gate-form{display:flex;flex-direction:column;gap:.6rem;width:100%;max-width:280px}
        .os-gate-input{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:.75rem 1rem;color:#fff;font-size:1rem;font-family:'DM Sans',sans-serif;text-align:center;outline:none;transition:border-color .2s ease;letter-spacing:.2em}
        .os-gate-input:focus{border-color:rgba(255,107,157,.5)}
        .os-gate-input::placeholder{letter-spacing:.06em;color:rgba(255,255,255,.2)}
        .os-gate-btn{background:linear-gradient(135deg,#ff6b9d,#e0437a);border:none;border-radius:14px;padding:.75rem;color:#fff;font-size:.95rem;font-weight:600;font-family:'DM Sans',sans-serif;cursor:pointer;transition:all .2s ease;box-shadow:0 4px 16px rgba(255,80,130,.35)}
        .os-gate-btn:hover{transform:translateY(-1px);filter:brightness(1.08)}
        .os-gate-error{font-size:.8rem;color:#ff8fab;margin-top:.2rem}
        .os-shake{animation:os-shake-anim .4s ease}
        @keyframes os-shake-anim{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-5px)}80%{transform:translateX(5px)}}

        @media(max-width:560px){
          .os-timeline::before{left:1.2rem}
          .os-timeline-item{width:100%;padding-left:3.5rem!important;padding-right:0!important;align-self:stretch!important}
          .os-left .os-dot,.os-right .os-dot{left:-.5rem!important;right:auto!important}
          .os-left{transform:translateX(-20px)}
          .os-right{transform:translateX(-20px)}
        }
      `}</style>

      <div className="os-page">
        {hearts.map((h, i) => (
          <FloatingHeart key={i} style={{
            left: h.left, animationDelay: h.animationDelay,
            animationDuration: h.animationDuration,
            fontSize: h.fontSize, opacity: h.opacity,
          }} />
        ))}

        <button className="os-back" onClick={() => navigate('/chat')}>{'\u2190'} Back</button>

        <div className="os-wrap">
          {!unlocked ? (
            <SecretGate onUnlock={() => setUnlocked(true)} />
          ) : (
            <>
              <div className="os-header">
                <div className="os-eyebrow">{'\u2726'} Our Journey {'\u2726'}</div>
                <h1>Our <span>Story</span></h1>
                <div className="os-header-sub">"hello {'\u2192'} apart {'\u2192'} together {'\u2192'} forever {'\uD83D\uDC95'}"</div>
              </div>

              <StatsBar />

              <div className="os-timeline">
                <TimerCard
                  index={0}
                  title="First Hello"
                  subtitle="The very beginning"
                  tag="The Beginning"
                  story="You were BTech classmates - roll number 91 and 92, sitting right next to each other on the list. You turned to her and asked her name. That one simple question changed everything. You had no idea the girl beside you would one day be the love of your life."
                  detail="Nov 28, 2022 - B.Tech Classroom"
                  icon={'\uD83D\uDCAC'}
                  accent="#c084fc"
                  glow="rgba(192,132,252,.45)"
                  delay={300}
                />

                <GapCard from={FIRST_TALK} to={FOUND_AGAIN} label="time apart" />

                <TimerCard
                  index={1}
                  title="Found Again"
                  subtitle="When we came back"
                  tag="The Reunion"
                  story="You were going through your darkest days when a college presentation put you both in the same group. The moment you started talking again it felt like sunlight coming back. She didn't just reconnect with you - she pulled you out of the dark and made you feel like yourself again."
                  detail="Mar 11, 2025 - College Presentation"
                  icon={'\uD83D\uDD01'}
                  accent="#ff8fab"
                  glow="rgba(255,107,157,.45)"
                  delay={500}
                />

                <GapCard from={FOUND_AGAIN} to={LOVE_START} label="growing closer" />

                <TimerCard
                  index={0}
                  title="In Love"
                  subtitle="When we said I love you"
                  tag="Forever Starts Here"
                  story="You told her how you felt long before this day. She asked for time - and you gave it to her with every ounce of patience and love you had. Then she saw it - your eternal love, your efforts. On a ride outside together she finally said it back. You felt like you won half your life."
                  detail="Oct 7, 2025 - On a Ride Together"
                  icon={'\u2764\uFE0F'}
                  accent="#ff6b9d"
                  glow="rgba(200,60,120,.45)"
                  delay={700}
                />
              </div>

              <div className="os-footer">
                <span className="os-footer-heart">{'\uD83D\uDC95'}</span>
                <div className="os-footer-quote">
                  "found each other twice -<br />
                  <span>loved each other forever</span>"
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

