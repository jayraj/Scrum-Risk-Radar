import { Link, useNavigate } from 'react-router-dom'
import { Target } from 'lucide-react'
import { useSnapshot } from '../hooks/useSnapshot'
import {
  severityClass,
  severityColor,
  sprintDayLabel,
} from '../utils/format'

interface RiskRadarProps {
  syncIntervalSeconds: number
  refreshKey?: number
}

export default function RiskRadar({ syncIntervalSeconds, refreshKey = 0 }: RiskRadarProps) {
  const { snapshot, loading, error, noProfile } = useSnapshot(syncIntervalSeconds, refreshKey)
  const navigate = useNavigate()

  const radarData = snapshot?.radar_data ?? []
  const blockers = snapshot?.blockers ?? []

  const hasRisks = radarData.some((r) => (r.risk_types?.length ?? 0) > 0)

  if (noProfile) {
    return (
      <div className="no-data">
        <p>No profile configured yet.</p>
        <Link className="details-btn" to="/settings">⚙️ Go to Settings to create a profile</Link>
      </div>
    )
  }

  if (error) {
    return <div className="loading">⚠️ {error} — check Settings → profile configuration.</div>
  }

  return (
    <div className="risk-radar">
      <h2 className="component-title"><Target size={24} className="title-icon" />CURRENT SPRINT(S)</h2>
      <p className="component-subtitle">Analyze risks in the current sprints</p>
      <div className="portfolio-meta">
        {new Set(radarData.map((r) => r.project_key).filter(Boolean)).size} projects ·{' '}
        {radarData.length} teams · {snapshot?.total_risks ?? 0} risks flagged
      </div>

      {loading ? (
        <div className="loading">Loading risks...</div>
      ) : (
        <>
          {radarData.length > 0 && !hasRisks && (
            <div className="smooth-banner">
              Hey there, Sprints are running smoothly. Please keep your eyes open for any risk that may incounter anytime.
            </div>
          )}
          {radarData.length > 0 && hasRisks && (
            <div className="risk-warning-banner">
              ⚠️ Attention, your one of the sprint is on RISK. Do an assesment proatively !!!!
            </div>
          )}

          <div className="radar-grid">
            {radarData.map((risk) => {
              const cardBlockers = blockers.filter((b) => b.sprint_key === risk.sprint_key)
              const critical = cardBlockers.filter((b) => b.severity === 'CRITICAL').length
              const high = cardBlockers.filter((b) => b.severity === 'HIGH').length
              const medium = cardBlockers.filter((b) => b.severity === 'MEDIUM').length
              const low = cardBlockers.filter((b) => b.severity === 'LOW').length
              const totalCardRisks = critical + high + medium + low

              return (
              <div key={risk.sprint_key} className={`risk-card ${severityClass(risk.severity)}`}>
                <div className="risk-header">
                  <span className="issue-key">
                    <span
                      className="status-dot"
                      style={{ backgroundColor: severityColor(risk.severity) }}
                    ></span>
                    {risk.sprint_key}
                    {sprintDayLabel(risk.start_date, risk.end_date) && (
                      <span className="sprint-day">
                        · {sprintDayLabel(risk.start_date, risk.end_date)}
                      </span>
                    )}
                  </span>
                  <span className="risk-score" style={{ backgroundColor: severityColor(risk.severity) }}>
                    {risk.risk_score}%
                  </span>
                </div>

                <div className="card-progress">
                  <span className="card-progress-label">
                    Progress {risk.total_sp > 0 ? Math.round((risk.completed_sp / risk.total_sp) * 100) : 0}%
                  </span>
                  <span className="card-progress-pts">
                    {risk.completed_sp} pt / {risk.total_sp} pt
                  </span>
                </div>

                <div className="risk-chips">
                  {totalCardRisks === 0 ? (
                    <span className="risk-chip low">No issues</span>
                  ) : (
                    <>
                      {critical > 0 && (
                        <span className="risk-chip critical">{critical} critical</span>
                      )}
                      {high > 0 && (
                        <span className="risk-chip high">{high} high</span>
                      )}
                      {medium > 0 && (
                        <span className="risk-chip medium">{medium} medium</span>
                      )}
                      {low > 0 && (
                        <span className="risk-chip low">{low} low</span>
                      )}
                    </>
                  )}
                </div>

                <div className="risk-footer">
                  <button className="details-btn" onClick={() => navigate(`/sprint/${encodeURIComponent(risk.sprint_key)}`)}>
                    Details →
                  </button>
                </div>
              </div>
            )})}
          </div>
        </>
      )}

      {radarData.length === 0 && !loading && (
        <div className="no-data">
          ✅ No active current sprints found. Start a sprint in Jira to see its risk radar here.
        </div>
      )}
    </div>
  )
}