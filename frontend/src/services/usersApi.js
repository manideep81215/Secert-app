import axios from 'axios'
import { API_APP_BASE_URL } from '../config/apiConfig'

const usersClient = axios.create({
  baseURL: `${API_APP_BASE_URL}/users`
})

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
