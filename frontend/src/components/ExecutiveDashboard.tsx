import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useSnapshot } from '../hooks/useSnapshot'
import { apiStakeholderReport, type DeliveryHealthProject } from '../api/client'
import { formatDate, formatDateTime, ringRiskColor, severityClass, severityColor } from '../utils/format'
import VelocityTrend from './VelocityTrend'

interface ExecutiveDashboardProps {
  syncIntervalSeconds: number
  refreshKey?: number
}

export default function ExecutiveDashboard({ syncIntervalSeconds, refreshKey = 0 }: ExecutiveDashboardProps) {
  const { snapshot, loading, error, noProfile } = useSnapshot(syncIntervalSeconds, refreshKey)
  const risks = snapshot?.risks ?? []
  const velocity = snapshot?.velocity ?? {}
  const healthProjects = snapshot?.delivery_health ?? []
  const [report, setReport] = useState('')
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)

  const fetchReport = async () => {
    setGenerating(true)
    try {
      const response = await apiStakeholderReport()
      setReport(response.report)
      setGeneratedAt(response.generated_at)
    } catch (error) {
      console.error('Error generating report:', error)
      setReport('Failed to generate report. Please try again.')
    } finally {
      setGenerating(false)
    }
  }

  const isBehind = (project: DeliveryHealthProject) =>
    !!project.forecast_date &&
    !!project.planned_end_date &&
    new Date(project.forecast_date) > new Date(project.planned_end_date)

  const ringDash = (score: number | undefined) => {
    const c = 2 * Math.PI * 22
    const s = Math.max(0, Math.min(100, score || 0))
    return `${(s / 100) * c} ${c}`
  }

  const projectCount = new Set([
    ...healthProjects.map((p) => p.project_key),
    ...Object.keys(velocity),
  ]).size
  const riskCount = risks.length

  if (noProfile) {
    return (
      <div className="no-data">
        <p>No profile configured yet.</p>
        <Link className="details-btn" to="/settings">⚙️ Go to Settings to create a profile</Link>
      </div>
    )
  }

  if (error) {
    return <div className="loading">⚠️ {error}</div>
  }

  return (
    <div className="executive-dashboard">
      <div className="ed-header">
        <div>
          <h2>📊 Portfolio Overview</h2>
          <p className="portfolio-summary">
            {projectCount} projects · {projectCount} teams · {riskCount} risks flagged
          </p>
        </div>
        <button className="generate-btn" onClick={fetchReport} disabled={generating}>
          {generating ? 'Generating...' : '🤖 Generate AI Report'}
        </button>
      </div>

      {loading ? (
        <div className="loading">Loading executive data...</div>
      ) : (
        <>
          <div className="widget-row">
            <div className="widget-card">
              <h3>🚦 Delivery Health</h3>
              {healthProjects.length === 0 ? (
                <div className="empty-cell">No active sprint data available.</div>
              ) : (
                <div className="health-projects">
                  {healthProjects.map((project) => (
                    <div key={project.project_key} className="health-row">
                      <div className="health-top">
                        <div className="health-project">
                          <div className="health-project-line">
                            <span className={`rag-badge ${project.rag.toLowerCase()}`}>{project.rag}</span>
                            <span className="health-project-key">{project.project_key}</span>
                            <span className="health-sprint">{project.sprint_key}</span>
                          </div>
                          <div className="health-project-dates">
                            <span className={`health-metric ${isBehind(project) ? 'danger' : ''}`}>
                              ⏱️ Planned: {formatDate(project.planned_end_date)}
                            </span>
                            <span className={`health-metric ${isBehind(project) ? 'danger' : ''}`}>
                              🔮 Forecast: {formatDate(project.forecast_date)}
                            </span>
                          </div>
                        </div>
                        <div className="health-ring-wrap">
                          <div className="ring" title={`Risk score: ${project.timeline_risk_score}/100`}>
                            <svg className="ring-svg" viewBox="0 0 52 52">
                              <circle className="ring-track" cx="26" cy="26" r="22"></circle>
                              <circle
                                className={`ring-bar ${ringRiskColor(project.timeline_risk_score)}`}
                                cx="26"
                                cy="26"
                                r="22"
                                strokeDasharray={ringDash(project.timeline_risk_score)}
                              ></circle>
                            </svg>
                            <span className={`ring-value ${ringRiskColor(project.timeline_risk_score)}`}>
                              {project.timeline_risk_score}
                            </span>
                          </div>
                          <span className="ring-label">Risk radar</span>
                          <span className="ring-progress">Progress {project.completion_percent}%</span>
                          <span className="ring-pts">{project.completed_sp} pt / {project.total_sp} pt</span>
                        </div>
                      </div>
                      <div className="health-metrics">
                        {project.forecast_delay_days > 0 && (
                          <span className="health-metric danger">⚠️ Slip: {project.forecast_delay_days} day(s)</span>
                        )}
                      </div>
                      {project.why && <p className="health-why">⚠️ {project.why}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <VelocityTrend velocity={velocity} />
          </div>

          {report ? (
            <div className="report-card">
              <h3>📝 AI Executive Summary</h3>
              <p className="report-text">{report}</p>
              {generatedAt && <div className="report-meta">Generated at {formatDateTime(generatedAt)}</div>}
            </div>
          ) : (
            !generating && (
              <div className="no-data">Click "Generate AI Report" to get an executive summary.</div>
            )
          )}

          <div className="risks-section">
            <h3>🔍 Current Sprint Risks</h3>
            {risks.length === 0 ? (
              <div className="empty-cell">✅ No risks detected in current sprints.</div>
            ) : (
              risks.slice(0, 10).map((risk, idx) => (
                <div key={`${risk.type}-${risk.issue_key || idx}`} className="risk-item">
                  <span className={`risk-type-badge ${severityClass(risk.severity)}`}>{risk.type}</span>
                  <span className="risk-summary">{risk.summary || risk.sprint_key || risk.issue_key}</span>
                  <span className="risk-score" style={{ backgroundColor: severityColor(risk.severity) }}>{risk.risk_score}</span>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}