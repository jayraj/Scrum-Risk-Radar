import { useEffect, useState } from 'react'
import { Routes, Route, Link } from 'react-router-dom'
import TopStrip from './components/TopStrip'
import DashboardHome from './components/DashboardHome'
import SprintDetails from './components/SprintDetails'
import FutureSprintDetailsPage from './components/FutureSprintDetailsPage'
import ExecutiveDashboard from './components/ExecutiveDashboard'
import Settings from './components/Settings'
import { apiSyncNow } from './api/client'
import { profileApi } from './api/config'
import { subscribeLastSync } from './hooks/useSnapshot'
import { formatLastSync } from './utils/format'

export default function App() {
  const [profiles, setProfiles] = useState(() => profileApi.list())
  const [activeProfile, setActiveProfile] = useState(() => profileApi.activeSlug())
  const [lastSync, setLastSync] = useState('Never')
  const [syncing, setSyncing] = useState(false)
  const [syncIntervalSeconds] = useState(300)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const unsubscribe = subscribeLastSync((value) => {
      if (value) setLastSync(formatLastSync(value))
    })
    return unsubscribe
  }, [])

  const refreshProfiles = () => setProfiles(profileApi.list())

  const handleSelectProfile = (slug: string) => {
    profileApi.setActiveSlug(slug)
    setActiveProfile(slug)
    setRefreshKey((k) => k + 1)
  }

  const syncNow = async () => {
    setSyncing(true)
    try {
      const response = await apiSyncNow()
      setLastSync(formatLastSync(response.last_sync))
      setRefreshKey((k) => k + 1)
      alert('Sync completed!')
    } catch (error) {
      console.error('Error syncing:', error)
      alert('Sync failed. Check the profile configuration.')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="app-container">
      <TopStrip
        lastSync={lastSync}
        syncing={syncing}
        onSyncNow={syncNow}
        profiles={profiles}
        activeProfile={activeProfile}
      />

      <div className="app-body">
        <main className="app-main">
          <Routes>
            <Route
              path="/"
              element={
                !activeProfile ? (
                  <div className="no-data">
                    <p>No profile configured yet.</p>
                    <Link className="details-btn" to="/settings">⚙️ Go to Settings to create a profile</Link>
                  </div>
                ) : (
                  <DashboardHome syncIntervalSeconds={syncIntervalSeconds} refreshKey={refreshKey} />
                )
              }
            />
            <Route
              path="/sprint/:sprintKey"
              element={<SprintDetails syncIntervalSeconds={syncIntervalSeconds} refreshKey={refreshKey} />}
            />
            <Route
              path="/future/:projectKey"
              element={<FutureSprintDetailsPage syncIntervalSeconds={syncIntervalSeconds} refreshKey={refreshKey} />}
            />
            <Route
              path="/executive"
              element={<ExecutiveDashboard syncIntervalSeconds={syncIntervalSeconds} refreshKey={refreshKey} />}
            />
            <Route
              path="/settings"
              element={<Settings onProfilesChanged={refreshProfiles} onSelectProfile={handleSelectProfile} />}
            />
          </Routes>
        </main>
      </div>
    </div>
  )
}