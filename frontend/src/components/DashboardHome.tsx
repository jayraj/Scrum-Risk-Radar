import RiskRadar from './RiskRadar'
import VelocityTrend from './VelocityTrend'
import NextSprintOverview from './NextSprintOverview'

interface DashboardHomeProps {
  syncIntervalSeconds: number
  refreshKey?: number
}

export default function DashboardHome({ syncIntervalSeconds, refreshKey = 0 }: DashboardHomeProps) {
  return (
    <div className="dashboard-home">
      <RiskRadar syncIntervalSeconds={syncIntervalSeconds} refreshKey={refreshKey} />
      <NextSprintOverview syncIntervalSeconds={syncIntervalSeconds} refreshKey={refreshKey} />
      <VelocityTrend syncIntervalSeconds={syncIntervalSeconds} refreshKey={refreshKey} />
    </div>
  )
}
