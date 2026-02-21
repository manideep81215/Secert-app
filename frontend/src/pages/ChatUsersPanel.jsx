import { AnimatePresence, motion } from 'framer-motion'

function ChatUsersPanel({
  filteredUsers,
  selectedUserId,
  searchQuery,
  onSearchQueryChange,
  onOpenGames,
  onStartNewChat,
  onSelectUser,
  getAvatarLabel,
  getUserDisplayName,
}) {
  return (
    <motion.div
      className="users-panel"
      initial={{ x: -300 }}
      animate={{ x: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="users-header">
        <h2>Messages</h2>
        <div className="users-header-actions">
          <button className="btn-users-games" onClick={onOpenGames} title="Go to dashboard" aria-label="Go to dashboard">
            {'\uD83C\uDFAE'}
          </button>
          <button className="btn-new-chat" onClick={onStartNewChat}>+</button>
        </div>
      </div>
      <div className="users-search">
        <input
          type="text"
          placeholder="Search users..."
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="text"
        />
      </div>
      <div className="users-list">
        <AnimatePresence>
          {filteredUsers.map((user) => (
            <motion.div
              key={user.id}
              className={`user-item ${selectedUserId === user.id ? 'active' : ''}`}
              onClick={() => onSelectUser(user)}
              whileHover={{ x: 10 }}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <div className="user-avatar">{getAvatarLabel(getUserDisplayName(user))}</div>
              <div className="user-info">
                <div className={`user-name ${user._hasUnread ? 'new-message' : ''}`}>{getUserDisplayName(user)}</div>
                <div className="user-last-msg">{user._isTyping ? 'typing...' : (user.lastMessage || 'No messages yet')}</div>
              </div>
              <div className={`user-status ${user._presence.status === 'online' ? 'online' : 'offline'}`} />
              <div className="user-time">{user._presenceTime}</div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

export default ChatUsersPanel
