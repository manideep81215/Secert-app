import { createApiClient } from './apiClient'
import { API_APP_BASE_URL } from '../config/apiConfig'

const messagesClient = createApiClient('/messages', 10000)
const chatStatsClient = createApiClient('/chat', 10000)
messagesClient.defaults.timeout = 20000

export async function getConversation(token, withUsername, options = {}) {
  const hasPagination = Number.isInteger(options?.page) || Number.isInteger(options?.size)
  const page = Number.isInteger(options?.page) ? options.page : 0
  const size = Number.isInteger(options?.size) ? options.size : 50
  const { data } = await messagesClient.get('/conversation', {
    params: {
      with: withUsername,
      ...(hasPagination ? { page, size } : {}),
    },
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })

  const normalized = Array.isArray(data)
    ? {
        messages: data,
        page: 0,
        size: data.length,
        hasMore: false,
        totalElements: data.length,
      }
    : {
        messages: Array.isArray(data?.messages) ? data.messages : [],
        page: Number(data?.page || 0),
        size: Number(data?.size || size),
        hasMore: Boolean(data?.hasMore),
        totalElements: Number(data?.totalElements || 0),
      }

  return hasPagination ? normalized : normalized.messages
}

export async function getConversationSummaries(token, options = {}) {
  const timeoutMs = Number(options?.timeoutMs || 0)
  const { data } = await messagesClient.get('/conversation-summaries', {
    timeout: timeoutMs > 0 ? timeoutMs : messagesClient.defaults.timeout,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  return Array.isArray(data) ? data : []
}

export async function uploadMedia(token, file, options = {}) {
  const onProgress = typeof options?.onProgress === 'function' ? options.onProgress : null
  const mediaKind = String(options?.mediaKind || '').trim().toLowerCase()
  const createForm = () => {
    const form = new FormData()
    const fileName = String(file?.name || `upload-${Date.now()}`).trim() || `upload-${Date.now()}`
    form.append('file', file, fileName)
    if (mediaKind) {
      form.append('kind', mediaKind)
    }
    return form
  }
  const nativeRuntime = typeof window !== 'undefined' && Boolean(window?.Capacitor?.isNativePlatform?.())
  const fetchUpload = async () => {
    const form = createForm()
    const response = await fetch(`${API_APP_BASE_URL}/messages/media`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    })
    if (!response.ok) {
      const fallbackError = new Error(`upload-failed-${response.status}`)
      fallbackError.response = { status: response.status }
      throw fallbackError
    }
    return response.json()
  }
  const axiosUpload = async () => {
    const form = createForm()
    const { data } = await messagesClient.post('/media', form, {
      timeout: 0,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      onUploadProgress: onProgress
        ? (event) => {
            const loaded = Number(event?.loaded || 0)
            const total = Number(event?.total || file?.size || 0)
            if (!total) return
            const percent = Math.max(1, Math.min(100, Math.round((loaded / total) * 100)))
            onProgress(percent)
          }
        : undefined,
    })
    return data
  }

  let firstError = null
  try {
    const data = nativeRuntime ? await fetchUpload() : await axiosUpload()
    if (onProgress) onProgress(100)
    return data
  } catch (error) {
    firstError = error
  }

  try {
    const data = nativeRuntime ? await axiosUpload() : await fetchUpload()
    if (onProgress) onProgress(100)
    return data
  } catch (secondError) {
    throw secondError || firstError
  }
}

export async function getChatStats(token, peerUsername, options = {}) {
  const trackMilestone = Boolean(options?.trackMilestone)
  const { data } = await chatStatsClient.get('/stats', {
    params: { peerUsername, trackMilestone },
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  return data || null
}

export async function reportChatOpen(token, openerUsername, conversationWithUsername) {
  const { data } = await chatStatsClient.post('/check-open', {
    openerUsername,
    conversationWithUsername,
  }, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  return data || { counted: false }
}

export async function consumeCheckNotice(token, senderUsername, checkerUsername) {
  await chatStatsClient.post('/check-open/consume', {
    senderUsername,
    checkerUsername,
  }, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
}
