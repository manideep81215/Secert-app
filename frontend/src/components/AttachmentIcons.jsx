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

export function CameraAttachIcon({ className = '', size = 20 }) {
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
      <path d="M3.2 8.4h17.6c0.7 0 1.2 0.5 1.2 1.2v8.8c0 1.6-1.3 2.8-2.8 2.8H4.8c-1.6 0-2.8-1.3-2.8-2.8V9.6c0-0.7 0.5-1.2 1.2-1.2Z" fill="#49B3E3" />
      <path d="M7.1 6.5c0.2-0.8 0.9-1.3 1.7-1.3h6.3c0.8 0 1.5 0.5 1.7 1.3l0.2 0.9h1.9c1.1 0 2 0.9 2 2H3c0-1.1 0.9-2 2-2h1.9l0.2-0.9Z" fill="#F2B35C" />
      <circle cx="12" cy="14.2" r="4.7" fill="#E9EDF2" />
      <circle cx="12" cy="14.2" r="3.4" fill="#5B6770" />
      <circle cx="12" cy="14.2" r="1.5" fill="#27313A" />
      <rect x="15.6" y="6.2" width="4.1" height="2.1" rx="0.7" fill="#E9EDF2" />
      <path d="M3 11.4h3.3" stroke="#2B7BA3" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M17.7 11.4H21" stroke="#2B7BA3" strokeWidth="1.3" strokeLinecap="round" />
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

export function DriveAttachIcon({ className = '', size = 20 }) {
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
      <path d="M7 5L2 12L7 19H17L22 12L17 5H7Z" fill="#4285F4" />
      <path d="M7 5L12 12L7 19" fill="#34A853" />
      <path d="M17 5L12 12L17 19" fill="#EA4335" />
    </svg>
  )
}
