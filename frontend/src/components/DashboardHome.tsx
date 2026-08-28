import RiskRadar from './RiskRadar'
import VelocityTrend from './VelocityTrend'
import NextSprintOverview from './NextSprintOverview'
import { useSnapshotValue } from '../hooks/useSnapshot'

interface DashboardHomeProps {
  onSelectDetail?: (selection: { kind: 'active' | 'future'; key: string }) => void
}

export default function DashboardHome({ onSelectDetail }: DashboardHomeProps) {
  const snapshot = useSnapshotValue()
  const workItems = snapshot?.sprint_overview?.projects ?? []

  return (
    <div className="dashboard-home">
      {/* DEBUG: active-sprint work-item counts (remove after 0-vs-4 investigation) */}
      {workItems.length > 0 && (
        <div className="debug-chip" style={{ marginBottom: 'var(--spacing-sm)' }}>
          🐞 {workItems.map((p) => `${p.project_key}: ${p.issue_count ?? 0}`).join('  ·  ')} work items
        </div>
      )}
      <RiskRadar onSelectDetail={onSelectDetail} />
      <NextSprintOverview onSelectDetail={onSelectDetail} />
      <VelocityTrend />
    </div>
  )
}
