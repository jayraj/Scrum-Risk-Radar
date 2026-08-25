import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Layers, Zap, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react'
import { sprintDayLabel } from '../utils/format'
import SprintGauge from './SprintGauge'
import type { Blocker } from '../api/client'

const SEVERITY_BADGE: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  CRITICAL: { bg: 'var(--badge-critical-bg)', text: 'var(--badge-critical-text)', dot: 'var(--badge-critical-dot)', label: 'critical' },
  HIGH: { bg: 'var(--badge-high-bg)', text: 'var(--badge-high-text)', dot: 'var(--badge-high-dot)', label: 'high' },
  MEDIUM: { bg: 'var(--badge-medium-bg)', text: 'var(--badge-medium-text)', dot: 'var(--badge-medium-dot)', label: 'medium' },
  LOW: { bg: 'var(--badge-low-bg)', text: 'var(--badge-low-text)', dot: 'var(--badge-low-dot)', label: 'low' },
}

export interface SprintCardData {
  sprint_key: string
  risk_score?: number | null
  issue_count?: number | null
  total_sp: number
  completed_sp?: number | null
  start_date?: string
  end_date?: string
}

interface SprintCardProps {
  data: SprintCardData
  blockers?: Blocker[]
  eyebrow?: string
  detailsTo?: string
  onDetails?: () => void
}

export default function SprintCard({ data, blockers = [], eyebrow = 'ACTIVE SPRINT', detailsTo, onDetails }: SprintCardProps) {
  const dayLabel = sprintDayLabel(data.start_date, data.end_date)
  const score = data.risk_score ?? 0
  const totalSp = data.total_sp ?? 0
  const completedSp = data.completed_sp ?? 0
  const progressPct = totalSp > 0 ? Math.round((completedSp / totalSp) * 100) : 0

  const counts = {
    CRITICAL: blockers.filter((b) => b.severity === 'CRITICAL').length,
    HIGH: blockers.filter((b) => b.severity === 'HIGH').length,
    MEDIUM: blockers.filter((b) => b.severity === 'MEDIUM').length,
    LOW: blockers.filter((b) => b.severity === 'LOW').length,
  }
  const totalRisks = counts.CRITICAL + counts.HIGH + counts.MEDIUM + counts.LOW

  const [shown, setShown] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const detailsHref = detailsTo ?? `/sprint/${encodeURIComponent(data.sprint_key)}`

  return (
    <div className="sprint-card">
      <div className="sprint-card-head">
        <span className="sprint-card-eyebrow">{eyebrow}</span>
        <div className="sprint-card-head-row">
          <span className="sprint-card-name" title={data.sprint_key}>{data.sprint_key}</span>
          {dayLabel && <span className="sprint-card-day">{dayLabel}</span>}
        </div>
      </div>

      <div className="sprint-card-body">
        <SprintGauge score={score} />
        <div className="sprint-card-tiles">
          <div className="sprint-card-tile">
            <Layers size={11} className="sprint-card-tile-icon" />
            <span className="sprint-card-tile-num">{data.issue_count ?? 0}</span>
            <span className="sprint-card-tile-label">work items</span>
          </div>
          <div className="sprint-card-tile">
            <Zap size={11} className="sprint-card-tile-icon" />
            <span className="sprint-card-tile-num">{totalSp}</span>
            <span className="sprint-card-tile-label">story points</span>
          </div>
        </div>
      </div>

      <div className="sprint-card-progress">
        <span className="sprint-card-progress-label">Progress</span>
        <span className="sprint-card-progress-pts">{completedSp} pt / {totalSp} pt</span>
        <div className="sprint-card-progress-track">
          <div className="sprint-card-progress-fill" style={{ width: shown ? `${progressPct}%` : '0%' }} />
        </div>
      </div>

      <div className="sprint-card-footer">
        <div className="sprint-card-status">
          {totalRisks === 0 ? (
            <span className="sprint-card-noissues">
              <CheckCircle2 size={12} /> No issues
            </span>
          ) : (
            (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((sev) =>
              counts[sev] > 0 ? (
                <span
                  key={sev}
                  className="sprint-card-badge"
                  style={{ background: SEVERITY_BADGE[sev].bg, color: SEVERITY_BADGE[sev].text }}
                >
                  <AlertCircle size={11} />
                  <span className="sprint-card-badge-dot" style={{ background: SEVERITY_BADGE[sev].dot }} />
                  {counts[sev]} {SEVERITY_BADGE[sev].label}
                </span>
              ) : null
            )
          )}
        </div>
        {onDetails ? (
          <button className="sprint-card-details" onClick={onDetails}>
            Details <ArrowRight size={12} className="sprint-card-details-arrow" />
          </button>
        ) : (
          <Link className="sprint-card-details" to={detailsHref}>
            Details <ArrowRight size={12} className="sprint-card-details-arrow" />
          </Link>
        )}
      </div>
    </div>
  )
}
