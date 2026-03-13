export const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')
export const API_APP_BASE_URL = `${API_BASE_URL}/api/app`
export const WS_CHAT_URL = `${API_BASE_URL}/ws-chat`
