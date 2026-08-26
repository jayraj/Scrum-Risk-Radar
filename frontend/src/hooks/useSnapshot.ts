import { useEffect, useState } from 'react'
import { apiSnapshot, type Snapshot } from '../api/client'
import { profileApi } from '../api/config'
import { setJiraTimezone } from '../utils/format'

export interface SnapshotState {
  snapshot: Snapshot | null
  loading: boolean
  error: string | null
  noProfile: boolean
}

type LastSyncListener = (lastSync: string | null) => void
let currentLastSync: string | null = null
const lastSyncListeners = new Set<LastSyncListener>()

// Shared polling: one fetch + one interval serve every mounted useSnapshot
// caller for the same profile, instead of N independent poll loops.
interface SharedState {
  slug: string
  intervalMs: number
  snapshot: Snapshot | null
  error: string | null
  loading: boolean
  inflight: Promise<void> | null
}
type StateListener = () => void

let shared: SharedState | null = null
const stateListeners = new Set<StateListener>()
let pollTimer: ReturnType<typeof setInterval> | null = null

const getLastSync = (): string | null => currentLastSync

const subscribeLastSync = (listener: LastSyncListener): (() => void) => {
  lastSyncListeners.add(listener)
  return () => {
    lastSyncListeners.delete(listener)
  }
}

const notifyLastSync = (value: string | null) => {
  currentLastSync = value
  lastSyncListeners.forEach((listener) => listener(value))
}

const notifyState = () => {
  stateListeners.forEach((listener) => listener())
}

const doFetch = async (): Promise<void> => {
  if (!shared || shared.inflight) return
  const promise = apiSnapshot()
    .then((data) => {
      if (shared) {
        shared.snapshot = data
        shared.error = null
        // Drive every date display from the Jira timezone so they match the
        // Jira UI, regardless of the viewer's machine timezone.
        setJiraTimezone(data.jira_timezone)
        notifyLastSync(data.last_sync)
      }
    })
    .catch((err: unknown) => {
      if (shared) {
        shared.error = err instanceof Error ? err.message : 'Failed to load snapshot'
      }
    })
    .finally(() => {
      if (shared) {
        shared.inflight = null
        shared.loading = false
      }
      notifyState()
    })
  shared.inflight = promise
  await promise
}

const startPolling = (slug: string, syncIntervalSeconds: number, force: boolean): void => {
  const intervalMs = Math.max(syncIntervalSeconds, 10) * 1000
  if (!shared || shared.slug !== slug) {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    shared = { slug, intervalMs, snapshot: null, error: null, loading: true, inflight: null }
  }
  shared.intervalMs = intervalMs
  if (!pollTimer) {
    pollTimer = setInterval(() => void doFetch(), shared.intervalMs)
  }
  if (!shared.snapshot || force) {
    void doFetch()
  }
}

const stopPollingIfIdle = (): void => {
  if (stateListeners.size === 0) {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    shared = null
  }
}

export function useSnapshot(syncIntervalSeconds: number, refreshKey = 0): SnapshotState {
  const [, setTick] = useState(0)

  useEffect(() => {
    const listener = () => setTick((t) => t + 1)
    const active = profileApi.active()

    if (!active) {
      stopPollingIfIdle()
      return () => {
        stopPollingIfIdle()
      }
    }

    stateListeners.add(listener)
    startPolling(active.slug, syncIntervalSeconds, refreshKey > 0)

    return () => {
      stateListeners.delete(listener)
      stopPollingIfIdle()
    }
  }, [syncIntervalSeconds, refreshKey])

  if (!profileApi.active()) {
    return { snapshot: null, loading: false, error: null, noProfile: true }
  }

  return {
    snapshot: shared?.snapshot ?? null,
    loading: shared ? shared.loading && !shared.snapshot : true,
    error: shared?.error ?? null,
    noProfile: false,
  }
}

export { getLastSync, subscribeLastSync }
