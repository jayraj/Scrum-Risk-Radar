import { createContext, useContext } from 'react'

export interface SyncContextValue {
  syncIntervalSeconds: number
  refreshKey: number
}

export const SyncContext = createContext<SyncContextValue | null>(null)

export const useSync = (): SyncContextValue => {
  const value = useContext(SyncContext)
  if (!value) {
    throw new Error('useSync must be used within a SyncContext provider')
  }
  return value
}
