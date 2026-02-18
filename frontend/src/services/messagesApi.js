import axios from 'axios'

const messagesClient = axios.create({
  baseURL: 'http://localhost:8080/api/app/messages',
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
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'multipart/form-data',
    },
  })
  return data
}
