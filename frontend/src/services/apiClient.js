import axios from 'axios'
import { API_APP_BASE_URL } from '../config/apiConfig'
import { getFlowSnapshot, setFlowStateSnapshot } from '../hooks/useFlowState'
import { refreshAccessToken } from './authApi'

let refreshPromise = null
const SAFE_RETRY_METHODS = new Set(['get', 'head', 'options'])
const TRANSIENT_NETWORK_CODES = new Set(['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT'])
const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])
const MAX_TRANSIENT_RETRIES = 2

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function isSafeRetryMethod(config) {
  const method = String(config?.method || 'get').trim().toLowerCase()
  return SAFE_RETRY_METHODS.has(method)
}

function isTransientFailure(error) {
  const status = Number(error?.response?.status || 0)
  const code = String(error?.code || '').trim().toUpperCase()
  if (!status) {
    return TRANSIENT_NETWORK_CODES.has(code) || !code
  }
  return TRANSIENT_HTTP_STATUSES.has(status) || status >= 500
}

function getTransientRetryDelayMs(attempt) {
  return Math.min(1800, 300 * (2 ** Math.max(0, attempt - 1)))
}

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
      const status = Number(error?.response?.status || 0)
      if (status === 401 || status === 403) {
        setFlowStateSnapshot((prev) => ({
          ...prev,
          token: '',
          refreshToken: '',
        }))
      }
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
      if (status === 401 && !originalConfig.__retriedWithRefresh) {
        originalConfig.__retriedWithRefresh = true
        const newAccessToken = await refreshSession()
        originalConfig.headers = {
          ...(originalConfig.headers || {}),
          Authorization: `Bearer ${newAccessToken}`,
        }
        return client(originalConfig)
      }

      const retryCount = Number(originalConfig.__transientRetryCount || 0)
      if (
        !originalConfig.__disableTransientRetry &&
        isSafeRetryMethod(originalConfig) &&
        isTransientFailure(error) &&
        retryCount < MAX_TRANSIENT_RETRIES
      ) {
        originalConfig.__transientRetryCount = retryCount + 1
        await wait(getTransientRetryDelayMs(originalConfig.__transientRetryCount))
        return client(originalConfig)
      }

      throw error
    }
  )

  return client
}
