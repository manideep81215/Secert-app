import axios from 'axios'
import { API_APP_BASE_URL } from '../config/apiConfig'

const pushClient = axios.create({
  baseURL: `${API_APP_BASE_URL}/push`,
  timeout: 10000,
})

export async function getPushPublicKey() {
  const { data } = await pushClient.get('/public-key')
  return data || { enabled: false, publicKey: '' }
}

export async function subscribePush(token, subscription) {
  const { data } = await pushClient.post('/subscribe', subscription, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  return data
}

export async function unsubscribePush(token, endpoint) {
  const { data } = await pushClient.delete('/subscribe', {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    data: endpoint ? { endpoint } : {},
  })
  return data
}

export async function sendTestPush(token, payload = {}) {
  const { data } = await pushClient.post('/test', payload, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  return data
}
