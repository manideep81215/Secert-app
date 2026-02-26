import { useCallback, useEffect, useState } from 'react'

const FLOW_KEY = 'arcade-date-flow-v1'

const emptyFlow = {
  userId: null,
  username: '',
  token: '',
  refreshToken: '',
  name: '',
  phone: '',
  dob: '',
  email: '',
  role: 'game',
  wins: {
    rps: 0,
    coin: 0,
    ttt: 0,
  },
  unlocked: false,
  verified: false,
}

const listeners = new Set()

const readStoredFlow = () => {
  if (typeof window === 'undefined') return { ...emptyFlow }
  try {
    const raw = window.localStorage.getItem(FLOW_KEY)
    if (!raw) return { ...emptyFlow }
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? { ...emptyFlow, ...parsed } : { ...emptyFlow }
  } catch {
    return { ...emptyFlow }
  }
}

let flowSnapshot = readStoredFlow()

const emitFlowChange = () => {
  for (const listener of listeners) {
    listener(flowSnapshot)
  }
}

const persistFlow = () => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(FLOW_KEY, JSON.stringify(flowSnapshot))
  } catch {
    // Ignore localStorage failures.
  }
}

const updateFlowSnapshot = (nextOrUpdater) => {
  const nextValue = typeof nextOrUpdater === 'function'
    ? nextOrUpdater(flowSnapshot)
    : nextOrUpdater
  flowSnapshot = { ...emptyFlow, ...(nextValue || {}) }
  persistFlow()
  emitFlowChange()
}

export function useFlowState() {
  const [flow, setFlowState] = useState(flowSnapshot)

  useEffect(() => {
    listeners.add(setFlowState)
    setFlowState(flowSnapshot)
    return () => {
      listeners.delete(setFlowState)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const onStorage = (event) => {
      if (event.key !== FLOW_KEY) return
      flowSnapshot = readStoredFlow()
      emitFlowChange()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setFlow = useCallback((nextOrUpdater) => {
    updateFlowSnapshot(nextOrUpdater)
  }, [])

  return [flow, setFlow]
}

export function getFlowSnapshot() {
  return flowSnapshot
}

export function setFlowStateSnapshot(nextOrUpdater) {
  updateFlowSnapshot(nextOrUpdater)
}

export function resetFlowState(setFlow) {
  setFlow(emptyFlow)
}

export function resetFlowScores(setFlow) {
  setFlow((prev) => ({
    ...prev,
    wins: {
      rps: 0,
      coin: 0,
      ttt: 0,
    },
    unlocked: false,
    verified: false,
  }))
}
