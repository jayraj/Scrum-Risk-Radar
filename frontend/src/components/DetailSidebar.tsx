import type { ReactNode } from 'react'
import SprintDetailPanel from './SprintDetailPanel'

export interface DetailSelection {
  kind: 'active' | 'future'
  key: string
}

interface DetailSidebarProps {
  selection: DetailSelection
  onClose: () => void
  syncIntervalSeconds: number
  refreshKey?: number
}

export default function DetailSidebar({
  selection,
  onClose,
  syncIntervalSeconds,
  refreshKey = 0,
}: DetailSidebarProps) {
  const content: ReactNode = (
    <SprintDetailPanel
      kind={selection.kind}
      sprintKey={decodeURIComponent(selection.key)}
      onClose={onClose}
      syncIntervalSeconds={syncIntervalSeconds}
      refreshKey={refreshKey}
    />
  )

  return (
    <aside className="detail-sidebar" aria-label="Sprint details">
      {content}
    </aside>
  )
}
