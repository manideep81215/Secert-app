import { useEffect, useState } from 'react'

const FLOW_KEY = 'arcade-date-flow-v1'

const emptyFlow = {
  userId: null,
  username: '',
  token: '',
  phone: '',
  dob: '',
  email: '',
  wins: {
    rps: 0,
    coin: 0,
    ttt: 0,
  },
  unlocked: false,
  verified: false,
}

export function useFlowState() {
  const [flow, setFlow] = useState(() => {
    const raw = localStorage.getItem(FLOW_KEY)
    if (!raw) return emptyFlow

    try {
      return { ...emptyFlow, ...JSON.parse(raw) }
    } catch {
      return emptyFlow
    }
  })

  useEffect(() => {
    localStorage.setItem(FLOW_KEY, JSON.stringify(flow))
  }, [flow])

  return [flow, setFlow]
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
