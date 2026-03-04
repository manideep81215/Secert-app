import { createApiClient } from './apiClient'

const messagesClient = createApiClient('/messages', 10000)
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

export async function getConversationSummaries(token) {
  const { data } = await messagesClient.get('/conversation-summaries', {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  return Array.isArray(data) ? data : []
}

export async function uploadMedia(token, file, options = {}) {
  const onProgress = typeof options?.onProgress === 'function' ? options.onProgress : null
  const form = new FormData()
  form.append('file', file)
  const { data } = await messagesClient.post('/media', form, {
    timeout: 0,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'multipart/form-data',
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
  if (onProgress) onProgress(100)
  return data
}
