export function PhotoAttachIcon({ className = '', size = 20 }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="2" y="2" width="20" height="20" rx="5" fill="url(#photoBg)" />
      <circle cx="16.7" cy="8.1" r="2.4" fill="#FFC300" />
      <path d="M2 15.6L7.7 10.2C8.8 9.2 10.5 9.3 11.4 10.4L13 12.3C13.6 13 14.7 13 15.3 12.4L17.2 10.7C18.3 9.7 20.1 9.8 21.1 10.8L22 11.8V22H2V15.6Z" fill="#49D690" />
      <defs>
        <linearGradient id="photoBg" x1="12" y1="2" x2="12" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4E96E8" />
          <stop offset="1" stopColor="#2A5ED9" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export function FileAttachIcon({ className = '', size = 20 }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 2.8h8l4 4V21.2H6V2.8Z" fill="#111" />
      <path d="M14 2.8v4h4" fill="#202020" />
      <path d="M8.4 11.2h7.2M8.4 14.1h7.2M8.4 17h4.8" stroke="#f4f4f4" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}
