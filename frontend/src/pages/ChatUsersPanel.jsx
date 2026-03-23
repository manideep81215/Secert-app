import { AnimatePresence, motion } from 'framer-motion'

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="4.5" y="4.5" width="15" height="15" rx="4.2" />
      <circle cx="12" cy="12" r="3.2" />
      <circle cx="16.8" cy="7.3" r="1.1" />
    </svg>
  )
}

function ChatUsersPanel({
  filteredUsers,
  selectedUserId,
  searchQuery,
  onSearchQueryChange,
  onOpenInstagram,
  onOpenGames,
  onStartNewChat,
  onSelectUser,
  getAvatarLabel,
  getUserDisplayName,
  reducedMotion = false,
}) {
  const renderUserItem = (user) => {
    if (reducedMotion) {
      return (
        <div
          key={user.id}
          className={`user-item ${selectedUserId === user.id ? 'active' : ''}`}
          onClick={() => onSelectUser(user)}
        >
          <div className="user-avatar">{getAvatarLabel(getUserDisplayName(user))}</div>
          <div className="user-info">
            <div className={`user-name ${user._hasUnread ? 'new-message' : ''}`}>{getUserDisplayName(user)}</div>
            <div className="user-last-msg">{user._isTyping ? 'typing...' : (user.lastMessage || 'No messages yet')}</div>
          </div>
          <div className={`user-status ${user._presence.status === 'online' ? 'online' : 'offline'}`} />
          <div className="user-time">{user._presenceTime}</div>
        </div>
      )
    }

    return (
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
    )
  }

  const usersList = reducedMotion ? (
    filteredUsers.map((user) => renderUserItem(user))
  ) : (
    <AnimatePresence>
      {filteredUsers.map((user) => renderUserItem(user))}
    </AnimatePresence>
  )

  if (reducedMotion) {
    return (
      <div className="users-panel">
        <div className="users-header">
          <h2>Messages</h2>
          <div className="users-header-actions">
            <button
              className="btn-users-instagram"
              onClick={onOpenInstagram}
              title="Open Instagram reel"
              aria-label="Open Instagram reel"
            >
              <InstagramIcon />
            </button>
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
        <div className="users-list">{usersList}</div>
      </div>
    )
  }

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
          <button
            className="btn-users-instagram"
            onClick={onOpenInstagram}
            title="Open Instagram reel"
            aria-label="Open Instagram reel"
          >
            <InstagramIcon />
          </button>
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
        {usersList}
      </div>
    </motion.div>
  )
}

export default ChatUsersPanel
