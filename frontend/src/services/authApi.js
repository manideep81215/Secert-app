import axios from 'axios'
import { API_APP_BASE_URL } from '../config/apiConfig'

const authClient = axios.create({
  baseURL: `${API_APP_BASE_URL}/auth`,
  timeout: 7000,
})

export async function registerUser(payload) {
  const { data } = await authClient.post('/register', payload)
  return data
}

export async function loginUser(payload) {
  const { data } = await authClient.post('/login', payload)
  return data
}

export async function getMe(token) {
  const { data } = await authClient.get('/me', {
    headers: { Authorization: `Bearer ${token}` },
  })
  return data
}
