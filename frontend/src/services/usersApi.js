import { createApiClient } from './apiClient'

const usersClient = createApiClient('/users')

export async function getAllUsers(token) {
  const { data } = await usersClient.get('', {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  return data || []
}

export async function searchUsersByUsername(username, token) {
  const { data } = await usersClient.get('/search', {
    params: { username },
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  return data || []
}

export async function getUserById(userId, token) {
  const { data } = await usersClient.get(`/${userId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  return data
}

export async function hasSecretKey(userId, token) {
  const { data } = await usersClient.get(`/${userId}/secret-key-exists`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  return data
}

export async function setSecretKey(userId, secretKey, token) {
  const { data } = await usersClient.post(`/${userId}/secret-key`, { secretKey }, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  return data
}

export async function verifySecretKey(userId, secretKey, token) {
  const { data } = await usersClient.post(`/${userId}/verify-secret-key`, { secretKey }, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  return data
}
