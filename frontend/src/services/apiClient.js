import axios from 'axios'
import { API_APP_BASE_URL } from '../config/apiConfig'
import { getFlowSnapshot, setFlowStateSnapshot } from '../hooks/useFlowState'
import { refreshAccessToken } from './authApi'

let refreshPromise = null

async function refreshSession() {
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    const snapshot = getFlowSnapshot()
    const refreshToken = (snapshot?.refreshToken || '').trim()
    if (!refreshToken) {
      throw new Error('missing-refresh-token')
    }
    const data = await refreshAccessToken(refreshToken)
    const nextAccessToken = (data?.token || '').trim()
    const nextRefreshToken = (data?.refreshToken || '').trim()
    if (!nextAccessToken || !nextRefreshToken) {
      throw new Error('invalid-refresh-response')
    }

    setFlowStateSnapshot((prev) => ({
      ...prev,
      userId: data?.userId ?? prev.userId,
      username: data?.username || prev.username,
      token: nextAccessToken,
      refreshToken: nextRefreshToken,
    }))

    return nextAccessToken
  })()
    .catch((error) => {
      setFlowStateSnapshot((prev) => ({
        ...prev,
        token: '',
        refreshToken: '',
      }))
      throw error
    })
    .finally(() => {
      refreshPromise = null
    })

  return refreshPromise
}

export function createApiClient(path, timeout = 10000) {
  const client = axios.create({
    baseURL: `${API_APP_BASE_URL}${path}`,
    timeout,
  })

  client.interceptors.request.use((config) => {
    if (!config.headers?.Authorization) {
      const token = (getFlowSnapshot()?.token || '').trim()
      if (token) {
        config.headers = {
          ...config.headers,
          Authorization: `Bearer ${token}`,
        }
      }
    }
    return config
  })

  client.interceptors.response.use(
    (response) => response,
    async (error) => {
      const status = Number(error?.response?.status || 0)
      const originalConfig = error?.config || {}
      if (status !== 401 || originalConfig.__retriedWithRefresh) {
        throw error
      }

      originalConfig.__retriedWithRefresh = true
      const newAccessToken = await refreshSession()
      originalConfig.headers = {
        ...(originalConfig.headers || {}),
        Authorization: `Bearer ${newAccessToken}`,
      }
      return client(originalConfig)
    }
  )

  return client
}
