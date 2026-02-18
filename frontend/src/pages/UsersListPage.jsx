import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'react-toastify'
import { useFlowState } from '../hooks/useFlowState'
import { getAllUsers } from '../services/usersApi'
import './UsersListPage.css'

function UsersListPage() {
  const navigate = useNavigate()
  const [flow] = useFlowState()
  const [users, setUsers] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [statusMap, setStatusMap] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!flow.token || !flow.username) {
      navigate('/auth')
      return
    }
    if (!flow.verified) {
      navigate('/verify')
      return
    }

    const loadUsers = async () => {
      try {
        const dbUsers = await getAllUsers(flow.token)
        const me = (flow.username || '').toLowerCase()
        const filtered = (dbUsers || [])
          .filter((user) => (user?.username || '').toLowerCase() !== me)
          .map((user) => ({
            id: user.id,
            username: user.username,
            status: 'offline',
            lastMessage: 'No messages yet',
            lastMessageTime: 'now',
          }))
        setUsers(filtered)
      } catch (error) {
        console.error('Failed to load users', error)
        toast.error('Failed to load users')
      } finally {
        setLoading(false)
      }
    }

    loadUsers()
  }, [flow.token, flow.username, flow.verified, navigate])

  const formatUsername = (username) => {
    return username ? username.charAt(0).toUpperCase() + username.slice(1).toLowerCase() : ''
  }

  const getAvatarLabel = (username) => {
    return username ? username.substring(0, 2).toUpperCase() : '?'
  }

  const filteredUsers = users.filter((user) =>
    user.username.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="users-list-page">
      <div className="users-header">
        <h1>Messages</h1>
        <button className="btn-new-chat" onClick={() => navigate('/chat')}>
          +
        </button>
      </div>

      <div className="users-search-container">
        <input
          type="text"
          placeholder="Search users..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="users-search-input"
        />
      </div>

      <div className="users-list-container">
        {loading ? (
          <div className="loading">Loading users...</div>
        ) : filteredUsers.length === 0 ? (
          <div className="no-users">
            {users.length === 0 ? 'No users available' : 'No users found'}
          </div>
        ) : (
          <AnimatePresence>
            {filteredUsers.map((user) => (
              <motion.div
                key={user.id}
                className="user-card"
                onClick={() => navigate('/chat', { state: { selectedUserId: user.id, selectedUsername: user.username } })}
                whileHover={{ backgroundColor: 'rgba(0,0,0,0.02)' }}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <div className="user-avatar">{getAvatarLabel(user.username)}</div>
                <div className="user-card-info">
                  <div className="user-card-name">@{formatUsername(user.username)}</div>
                  <div className="user-card-last-msg">{user.lastMessage}</div>
                </div>
                <div className={`user-card-status ${user.status}`} />
                <div className="user-card-time">{user.lastMessageTime}</div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  )
}

export default UsersListPage
