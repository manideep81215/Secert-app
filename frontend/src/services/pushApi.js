import { createApiClient } from './apiClient'

const pushClient = createApiClient('/push', 10000)

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

export async function subscribeMobilePush(token, payload) {
  const { data } = await pushClient.post('/mobile-token', payload, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  return data
}

export async function unsubscribeMobilePush(token, mobileToken) {
  const { data } = await pushClient.delete('/mobile-token', {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    data: mobileToken ? { token: mobileToken } : {},
  })
  return data
}
