import axios from 'axios'
import { API_APP_BASE_URL } from '../config/apiConfig'
import { getFlowSnapshot, setFlowStateSnapshot } from '../hooks/useFlowState'

const authClient = axios.create({
  baseURL: `${API_APP_BASE_URL}/auth`,
  timeout: 7000,
  headers: {
    'Content-Type': 'application/json',
  },
})

export async function registerUser(payload) {
  const { data } = await authClient.post('/register', payload)
  return data
}

export async function loginUser(payload) {
  const { data } = await authClient.post('/login', payload)
  return data
}

export async function refreshAccessToken(refreshToken) {
  const { data } = await authClient.post('/refresh', { refreshToken })
  return data
}

export async function getMe(token) {
  try {
    const { data } = await authClient.get('/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
    return data
  } catch (error) {
    if (Number(error?.response?.status || 0) !== 401) throw error

    const refreshToken = (getFlowSnapshot()?.refreshToken || '').trim()
    if (!refreshToken) throw error

    const refreshed = await refreshAccessToken(refreshToken)
    const nextToken = (refreshed?.token || '').trim()
    const nextRefreshToken = (refreshed?.refreshToken || '').trim()
    if (!nextToken || !nextRefreshToken) throw error

    setFlowStateSnapshot((prev) => ({
      ...prev,
      token: nextToken,
      refreshToken: nextRefreshToken,
    }))

    const { data } = await authClient.get('/me', {
      headers: { Authorization: `Bearer ${nextToken}` },
    })
    return data
  }
}
