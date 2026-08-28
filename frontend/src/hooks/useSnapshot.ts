import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { apiSnapshot, type Snapshot } from '../api/client'
import { profileApi } from '../api/config'
import { setJiraTimezone } from '../utils/format'

export interface SnapshotState {
  snapshot: Snapshot | null
  loading: boolean
  error: string | null
  noProfile: boolean
}

interface StoreState extends SnapshotState {
  lastSync: string | null
}

let current: StoreState = {
  snapshot: null,
  loading: false,
  error: null,
  noProfile: false,
  lastSync: null,
}

const listeners = new Set<() => void>()

const emit = (): void => {
  listeners.forEach((listener) => listener())
}

const setStore = (patch: Partial<StoreState>): void => {
  current = { ...current, ...patch }
  emit()
}

const lastSyncListeners = new Set<(lastSync: string | null) => void>()

export const subscribeLastSync = (listener: (lastSync: string | null) => void): (() => void) => {
  lastSyncListeners.add(listener)
  listener(current.lastSync)
  return () => {
    lastSyncListeners.delete(listener)
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null
let activeSlug: string | null = null
let inflight: Promise<void> | null = null

const doFetch = (): Promise<void> => {
  if (!activeSlug) return Promise.resolve()
  if (inflight) return inflight

  const promise = (async () => {
    try {
      const data = await apiSnapshot()
      // DEBUG: current + upcoming work-item counts (remove after investigation)
      console.log(
        '[debug] work items — current',
        (data.radar_data ?? []).map((r) => ({ sprint: r.sprint_key, count: r.issue_count ?? 0 })),
        '| upcoming',
        (data.next_sprint_overview?.projects ?? []).map((p) => ({ project: p.project_key, count: p.issue_count ?? 0 })),
      )
      // DEBUG: jira_timezone + per-sprint active risk breakdown (severity is tz-dependent)
      console.log(
        '[debug] jira_timezone =',
        data.jira_timezone,
        '| active risks',
        (data.blockers ?? [])
          .filter((b) => (b.sprint_key ?? '').includes('MOS'))
          .map((b) => ({
            sprint: b.sprint_key,
            type: b.type,
            sev: b.severity,
            days_overdue: b.days_overdue ?? (b.overdue_issues ? b.overdue_issues.length : undefined),
            stalled: b.stalled_issues ? b.stalled_issues.length : undefined,
            hours_since_update: b.hours_since_update,
          })),
      )
      // DEBUG: raw sprint issue inputs for MOS (exposes avg_sp / status mix differences)
      const mosKey = Object.keys(data.sprint_data ?? {}).find(
        (k) => (data.sprint_data?.[k]?.sprint?.name ?? '').includes('MOS Sprint 6'),
      )
      const mos = mosKey ? data.sprint_data?.[mosKey] : undefined
      const mosIssues = mos?.issues ?? []
      const statusHist: Record<string, number> = {}
      for (const i of mosIssues) {
        const s = (i.status ?? '?').toString()
        statusHist[s] = (statusHist[s] ?? 0) + 1
      }
      const sps = mosIssues.map((i) => i.story_points ?? 0).filter((x) => x > 0)
      const radarMos = (data.radar_data ?? []).find((r) => r.sprint_key?.includes('MOS Sprint 6'))
      console.log(
        '[debug] MOS Sprint 6 inputs',
        {
          issue_count: mosIssues.length,
          status_hist: statusHist,
          avg_sp: sps.length ? +(sps.reduce((a, b) => a + b, 0) / sps.length).toFixed(2) : 0,
          radar_start: radarMos?.start_date,
          radar_end: radarMos?.end_date,
          radar_total_sp: radarMos?.total_sp,
          radar_completed_sp: radarMos?.completed_sp,
          burndown_history: (data.burndown_history ?? {})[mos?.sprint?.name ?? ''] ?? 'NONE',
        },
      )
      setStore({ snapshot: data, error: null, loading: false })
      setJiraTimezone(data.jira_timezone)
      if (data.last_sync !== current.lastSync) {
        current.lastSync = data.last_sync
        lastSyncListeners.forEach((listener) => listener(data.last_sync))
      }
    } catch (err) {
      setStore({
        error: err instanceof Error ? err.message : 'Failed to load snapshot',
        loading: false,
      })
    } finally {
      inflight = null
    }
  })()

  inflight = promise
  return promise
}

const startPolling = (slug: string, intervalSeconds: number): void => {
  activeSlug = slug
  const intervalMs = Math.max(intervalSeconds, 10) * 1000
  if (!pollTimer) {
    pollTimer = setInterval(() => void doFetch(), intervalMs)
  }
  if (!current.snapshot) {
    setStore({ loading: true })
  }
  void doFetch()
}

const stopPolling = (): void => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  activeSlug = null
  inflight = null
}

export function useSnapshot(syncIntervalSeconds: number, refreshKey = 0): SnapshotState {
  const subscribe = useCallback((callback: () => void) => {
    listeners.add(callback)
    return () => {
      listeners.delete(callback)
    }
  }, [])

  const getSnapshot = useCallback(() => current, [])

  const active = profileApi.active()
  const slug = active?.slug

  useEffect(() => {
    if (!slug) {
      setStore({ noProfile: true, snapshot: null, loading: false, error: null })
      stopPolling()
      return
    }
    setStore({ noProfile: false })
    startPolling(slug, syncIntervalSeconds)
  }, [slug, syncIntervalSeconds, refreshKey])

  return useSyncExternalStore(subscribe, getSnapshot)
}

// Read-only subscription: mirrors the store without starting/resetting polling.
// Used by debug-only UI that only needs the latest snapshot value.
export function useSnapshotValue(): Snapshot | null {
  const subscribe = useCallback((callback: () => void) => {
    listeners.add(callback)
    return () => {
      listeners.delete(callback)
    }
  }, [])
  const getSnapshot = useCallback(() => current.snapshot, [])
  return useSyncExternalStore(subscribe, getSnapshot)
}
