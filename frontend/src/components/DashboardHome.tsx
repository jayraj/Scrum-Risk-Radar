import RiskRadar from './RiskRadar'
import VelocityTrend from './VelocityTrend'
import NextSprintOverview from './NextSprintOverview'

interface DashboardHomeProps {
  onSelectDetail?: (selection: { kind: 'active' | 'future'; key: string }) => void
}

export default function DashboardHome({ onSelectDetail }: DashboardHomeProps) {
  return (
    <div className="dashboard-home">
      <RiskRadar onSelectDetail={onSelectDetail} />
      <NextSprintOverview onSelectDetail={onSelectDetail} />
      <VelocityTrend />
    </div>
  )
}
