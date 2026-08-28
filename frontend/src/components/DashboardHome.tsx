import RiskRadar from './RiskRadar'
import VelocityTrend from './VelocityTrend'
import NextSprintOverview from './NextSprintOverview'
import { useSnapshotValue } from '../hooks/useSnapshot'

interface DashboardHomeProps {
  onSelectDetail?: (selection: { kind: 'active' | 'future'; key: string }) => void
}

export default function DashboardHome({ onSelectDetail }: DashboardHomeProps) {
  const snapshot = useSnapshotValue()
  const activeSprints = snapshot?.radar_data ?? []
  const upcomingSprints = snapshot?.next_sprint_overview?.projects ?? []

  return (
    <div className="dashboard-home">
      {/* DEBUG: work-item counts for current + upcoming sprints (remove after investigation) */}
      {(activeSprints.length > 0 || upcomingSprints.length > 0) && (
        <div
          className="debug-chip"
          style={{ marginBottom: 'var(--spacing-sm)', display: 'flex', flexWrap: 'wrap', gap: '12px' }}
        >
          <span>
            🐞 CURRENT:{' '}
            {activeSprints.length > 0
              ? activeSprints.map((r) => `${r.sprint_key}: ${r.issue_count ?? 0}`).join('  ·  ')
              : '—'}
          </span>
          <span>
            UPCOMING:{' '}
            {upcomingSprints.length > 0
              ? upcomingSprints.map((p) => `${p.project_key}: ${p.issue_count ?? 0}`).join('  ·  ')
              : '—'}
          </span>
        </div>
      )}
      <RiskRadar onSelectDetail={onSelectDetail} />
      <NextSprintOverview onSelectDetail={onSelectDetail} />
      <VelocityTrend />
    </div>
  )
}
