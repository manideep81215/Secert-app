import axios from 'axios'

const authClient = axios.create({
  baseURL: 'http://localhost:8080/api/app/auth',
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
