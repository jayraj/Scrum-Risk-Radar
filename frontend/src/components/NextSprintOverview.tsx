import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { useSnapshot } from '../hooks/useSnapshot'
import SprintCard from './SprintCard'

interface NextSprintOverviewProps {
  syncIntervalSeconds: number
  refreshKey?: number
}

export default function NextSprintOverview({ syncIntervalSeconds, refreshKey = 0 }: NextSprintOverviewProps) {
  const { snapshot, loading, error, noProfile } = useSnapshot(syncIntervalSeconds, refreshKey)
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
        <div className="sprint-card-grid">
          {projects.map((project) => (
            <SprintCard
              key={project.project_key}
              data={project}
              eyebrow="UPCOMING SPRINT"
              detailsTo={`/future/${encodeURIComponent(project.project_key)}`}
            />
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
