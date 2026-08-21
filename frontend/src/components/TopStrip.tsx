import { Link } from 'react-router-dom'
import { Radar, RefreshCw, Settings } from 'lucide-react'
import { type ProfileCred } from '../api/config'

interface TopStripProps {
  lastSync: string
  syncing: boolean
  onSyncNow: () => void
  profiles: ProfileCred[]
  activeProfile: string | null
}

export default function TopStrip({
  lastSync,
  syncing,
  onSyncNow,
  profiles,
  activeProfile,
}: TopStripProps) {
  const activeLabel = profiles.find((p) => p.slug === activeProfile)?.label || activeProfile

  return (
    <header className="top-strip">
      <Link to="/" className="strip-brand" aria-label="Go to home">
        <Radar size={22} className="strip-brand-icon" />
        <span className="strip-brand-name">PORTFOLIO RISK RADAR</span>
      </Link>

      <div className="top-strip-actions">
        <span className="last-sync">Last sync: {lastSync}</span>

        <button onClick={onSyncNow} className="sync-btn" disabled={syncing || !activeProfile}>
          <RefreshCw size={14} className={syncing ? 'spin' : ''} />
          {syncing ? 'Syncing...' : 'Sync Now'}
        </button>

        <button className="icon-btn profile-btn" title={activeLabel || 'Profile'} aria-label="Active profile">
          <span className="profile-avatar">{(activeProfile ?? '??').slice(0, 2).toUpperCase()}</span>
        </button>

        <Link to="/settings" className="icon-btn settings-btn" aria-label="Settings" title="Settings">
          <Settings size={20} />
        </Link>
      </div>
    </header>
  )
}