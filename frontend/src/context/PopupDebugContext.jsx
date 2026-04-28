import { createContext, useState, useCallback } from 'react'

export const PopupDebugContext = createContext()

export function PopupDebugProvider({ children }) {
  const [debugFunctions, setDebugFunctions] = useState({})

  // Register a debug function for a popup
  const registerDebugFunction = useCallback((popupName, fn) => {
    setDebugFunctions((prev) => ({
      ...prev,
      [popupName]: fn,
    }))
  }, [])

  // Trigger a specific popup by name
  const triggerPopup = useCallback((popupName) => {
    const fn = debugFunctions[popupName]
    if (fn && typeof fn === 'function') {
      fn()
    }
  }, [debugFunctions])

  // Get all registered popup names
  const getRegisteredPopups = useCallback(() => {
    return Object.keys(debugFunctions)
  }, [debugFunctions])

  return (
    <PopupDebugContext.Provider
      value={{
        registerDebugFunction,
        triggerPopup,
        getRegisteredPopups,
      }}
    >
      {children}
    </PopupDebugContext.Provider>
  )
}
