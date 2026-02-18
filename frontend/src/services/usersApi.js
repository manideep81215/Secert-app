import axios from 'axios'

const usersClient = axios.create({
  baseURL: 'http://localhost:8080/api/app/users'
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
