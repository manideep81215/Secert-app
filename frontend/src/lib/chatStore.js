import { openDB } from 'idb'

const DB_NAME = 'arcade-date-db'
const STORE = 'messages'

const dbPromise = openDB(DB_NAME, 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(STORE)) {
      const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
      store.createIndex('by_mode', 'mode')
      store.createIndex('by_created', 'createdAt')
    }
  },
})

export async function loadMessages(mode) {
  const db = await dbPromise
  const tx = db.transaction(STORE)
  const index = tx.store.index('by_mode')
  const rows = await index.getAll(mode)
  return rows.sort((a, b) => a.createdAt - b.createdAt)
}

export async function addMessage(mode, message) {
  const db = await dbPromise
  return db.add(STORE, {
    mode,
    ...message,
    createdAt: Date.now(),
  })
}

export async function clearMessages(mode) {
  const db = await dbPromise
  const tx = db.transaction(STORE, 'readwrite')
  const index = tx.store.index('by_mode')
  let cursor = await index.openCursor(mode)

  while (cursor) {
    await cursor.delete()
    cursor = await cursor.continue()
  }

  await tx.done
}
