import { Link, useNavigate } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { useSnapshot } from '../hooks/useSnapshot'
import { formatDate, getRiskColor } from '../utils/format'

interface NextSprintOverviewProps {
  syncIntervalSeconds: number
  refreshKey?: number
}

export default function NextSprintOverview({ syncIntervalSeconds, refreshKey = 0 }: NextSprintOverviewProps) {
  const { snapshot, loading, error, noProfile } = useSnapshot(syncIntervalSeconds, refreshKey)
  const navigate = useNavigate()
  const projects = snapshot?.next_sprint_overview.projects ?? []

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
    <div className="next-sprint-overview">
      <h2 className="component-title"><Compass size={24} className="title-icon" />FUTURE SPRINT(S)</h2>
      <p className="component-subtitle">A pre-planning health check — catch unassigned, unestimated, or oversized work before day one.</p>

      {loading ? (
        <div className="loading">Loading next sprint data...</div>
      ) : (
        <div className="radar-grid">
          {projects.map((project) => (
            <div
              key={project.project_key}
              className="risk-card indigo"
              style={{ borderLeftColor: getRiskColor(project.risk_score) }}
            >
              <div className="risk-header">
                <span className="issue-key">
                  <span
                    className="status-dot"
                    style={{ backgroundColor: getRiskColor(project.risk_score) }}
                  />
                  {project.sprint_key}
                  {project.start_date && project.end_date && (
                    <span className="sprint-dates">
                      {' '}· {formatDate(project.start_date)} → {formatDate(project.end_date)}
                    </span>
                  )}
                </span>
                <span className="risk-score" style={{ backgroundColor: getRiskColor(project.risk_score) }}>
                  {project.risk_score !== undefined && project.risk_score !== null ? project.risk_score : 'N/A'}%
                </span>
              </div>

              <div className="risk-body">
                <div className="sprint-stats">
                  <div><span className="label">Planned work item(s):</span> {project.issue_count}</div>
                  <div><span className="label">Story Points:</span> {project.total_sp}</div>
                </div>
              </div>

              <div className="risk-footer">
                <button className="details-btn" onClick={() => navigate(`/future/${encodeURIComponent(project.project_key)}`)}>
                  Details →
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && projects.length === 0 && (
        <div className="no-data no-data-soft">
          ✅ No upcoming sprints in Jira. Follow N+1 planning to identify risks early.
        </div>
        
      )}
    </div>
  )
}