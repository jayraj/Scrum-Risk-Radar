import RiskRadar from './RiskRadar'
import VelocityTrend from './VelocityTrend'
import NextSprintOverview from './NextSprintOverview'

interface DashboardHomeProps {
  syncIntervalSeconds: number
  refreshKey?: number
  onSelectDetail?: (selection: { kind: 'active' | 'future'; key: string }) => void
}

export default function DashboardHome({ syncIntervalSeconds, refreshKey = 0, onSelectDetail }: DashboardHomeProps) {
  return (
    <div className="dashboard-home">
      <RiskRadar syncIntervalSeconds={syncIntervalSeconds} refreshKey={refreshKey} onSelectDetail={onSelectDetail} />
      <NextSprintOverview syncIntervalSeconds={syncIntervalSeconds} refreshKey={refreshKey} onSelectDetail={onSelectDetail} />
      <VelocityTrend syncIntervalSeconds={syncIntervalSeconds} refreshKey={refreshKey} />
    </div>
  )
}
