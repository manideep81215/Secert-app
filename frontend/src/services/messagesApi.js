import axios from 'axios'
import { API_APP_BASE_URL } from '../config/apiConfig'

const messagesClient = axios.create({
  baseURL: `${API_APP_BASE_URL}/messages`,
  timeout: 10000,
})

export async function getConversation(token, withUsername) {
  const { data } = await messagesClient.get('/conversation', {
    params: { with: withUsername },
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  return data || []
}

export async function uploadMedia(token, file) {
  const form = new FormData()
  form.append('file', file)
  const { data } = await messagesClient.post('/media', form, {
    timeout: 0,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'multipart/form-data',
    },
  })
  return data
}
