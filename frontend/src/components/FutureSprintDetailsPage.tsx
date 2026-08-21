import { Link, useParams } from 'react-router-dom'
import NextSprintDetails from './NextSprintDetails'
import { useSnapshot } from '../hooks/useSnapshot'

interface FutureSprintDetailsPageProps {
  syncIntervalSeconds: number
  refreshKey?: number
}

export default function FutureSprintDetailsPage({
  syncIntervalSeconds,
  refreshKey = 0,
}: FutureSprintDetailsPageProps) {
  const { projectKey } = useParams<{ projectKey: string }>()
  const { snapshot, loading, error, noProfile } = useSnapshot(syncIntervalSeconds, refreshKey)

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

  if (loading) {
    return <div className="loading">Loading sprint details...</div>
  }

  const project = snapshot?.next_sprint_overview?.projects.find(
    (p) => p.project_key === decodeURIComponent(projectKey ?? ''),
  )

  if (!project) {
    return (
      <div className="no-data">
        <p>Sprint not found for this project.</p>
        <Link className="details-btn" to="/">← Back to Dashboard</Link>
      </div>
    )
  }

  return (
    <NextSprintDetails
      project={project}
      syncIntervalSeconds={syncIntervalSeconds}
      refreshKey={refreshKey}
    />
  )
}
