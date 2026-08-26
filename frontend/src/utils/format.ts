// Severity palette anchored to the design-system semantic tokens:
// CRITICAL = error (#ef4444), MEDIUM = warning (#f59e0b), LOW = success (#10b981).
// HIGH uses a deepened warning (#d97706) to keep the four tiers distinguishable.
export const getRiskColor = (score: number | undefined | null): string => {
  if (score === undefined || score === null) return '#a1a1aa'
  if (score >= 80) return '#ef4444'
  if (score >= 60) return '#d97706'
  if (score >= 35) return '#f59e0b'
  return '#10b981'
}

export interface RiskDetectFields {
  issue_key?: string
  issue_keys?: string[]
  sprint_key?: string
  type: string
  hours_since_update?: number
  days_since_created?: number
  days_remaining?: number
  backlog_clear_days?: number
  burndown_gap_percent?: number
  stalled_issues?: { key: string; hours_since_update: number }[]
  overdue_issues?: { key: string; days_overdue: number }[]
}

export const riskTitle = (risk: RiskDetectFields): string => {
  if (risk.issue_key) return risk.issue_key
  if (risk.issue_keys && risk.issue_keys.length) return risk.issue_keys.join(', ')
  return risk.sprint_key || risk.type
}

export const riskDetected = (risk: RiskDetectFields): string => {
  if (risk.hours_since_update !== undefined && risk.hours_since_update !== null) {
    return `${Math.round(risk.hours_since_update)}h`
  }
  if (risk.days_since_created !== undefined && risk.days_since_created !== null) {
    return `${Math.round(risk.days_since_created)}d since raised`
  }
  if (risk.stalled_issues && risk.stalled_issues.length) {
    const maxHours = Math.max(...risk.stalled_issues.map((s) => s.hours_since_update))
    return `${Math.round(maxHours)}h`
  }
  if (risk.overdue_issues && risk.overdue_issues.length) {
    const maxDays = Math.max(...risk.overdue_issues.map((o) => o.days_overdue))
    return `${maxDays}d overdue`
  }
  if (risk.burndown_gap_percent !== undefined && risk.burndown_gap_percent !== null) {
    return `${risk.burndown_gap_percent}% gap`
  }
  if (risk.days_remaining !== undefined && risk.days_remaining !== null) {
    return `${risk.days_remaining}d left`
  }
  if (risk.backlog_clear_days !== undefined && risk.backlog_clear_days !== null) {
    return `${risk.backlog_clear_days}d`
  }
  return '—'
}

export const severityColor = (severity?: string): string => {
  switch ((severity || '').toUpperCase()) {
    case 'CRITICAL':
      return '#ef4444'
    case 'HIGH':
      return '#d97706'
    case 'MEDIUM':
      return '#f59e0b'
    default:
      return '#10b981'
  }
}

export const ringRiskColor = (score: number | undefined | null): string => {
  if (score === undefined || score === null) return 'ring-low'
  if (score >= 80) return 'ring-crit'
  if (score >= 60) return 'ring-high'
  if (score >= 35) return 'ring-med'
  return 'ring-low'
}

export const severityClass = (severity?: string): string =>
  severity ? severity.toLowerCase() : 'low'

export interface RiskStatus {
  label: string
  color: string
}

/** Status label by severity per design system: CRITICAL/HIGH → ACTIVE, MEDIUM → MONITORING, LOW → MITIGATED. */
export const riskStatusFor = (severity?: string): RiskStatus => {
  const s = (severity || '').toUpperCase()
  if (s === 'CRITICAL' || s === 'HIGH') {
    return { label: 'ACTIVE', color: severityColor(severity) }
  }
  if (s === 'MEDIUM') {
    return { label: 'MONITORING', color: severityColor('MEDIUM') }
  }
  return { label: 'MITIGATED', color: severityColor('LOW') }
}

export const formatRiskType = (type: string): string => {
  const map: Record<string, string> = {
    STORY_NOT_PROGRESSING: '📍 Not Progressing',
    STALLED_TICKETS: '🕒 Stalled Tickets',
    BURNDOWN_BEHIND: '📉 Burndown Behind',
    QA_BOTTLENECK: '🧪 QA Bottleneck',
    EXTERNAL_DEPENDENCY: '🔗 External Dep',
    UNASSIGNED: '👤 Unassigned',
    UNESTIMATED: '📐 Unestimated',
    UNDEFINED_SCOPE: '📝 Undefined Scope',
    SIZING_RISK: '🏗️ Oversized',
    DUE_DATE_PASSED: '⏰ Due Date Passed',
    BUG_RAISED: '🐛 Bug Raised',
    SCOPE_CREEP: '📈 Scope Creep',
    SPRINT_ENDED_INCOMPLETE: 'Sprint Ended Incomplete',
  }
  return map[type] || type
}

export const splitItems = (text?: string): string[] => {
  if (!text) return []
  return text.split(';').map((s) => s.trim()).filter(Boolean)
}

export const formatDate = (iso?: string): string => {
  if (!iso) return 'N/A'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'N/A'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export const formatDateTime = (iso?: string): string => {
  if (!iso) return ''
  return new Date(iso).toLocaleString()
}

export const formatLastSync = (iso?: string): string => {
  if (!iso) return 'Just now'
  const normalized = /Z$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return 'Just now'
  return date.toLocaleTimeString(undefined, { timeZoneName: 'short' })
}

export const shortSprintName = (name?: string): string => {
  if (!name) return '?'
  const match = name.match(/(\d+)\s*$/)
  return match ? 'S' + match[1] : name.slice(0, 6)
}

export const sprintDayLabel = (startDate?: string, endDate?: string): string | null => {
  if (!startDate || !endDate) return null
  const DAY_MS = 86400000
  // Parse only the calendar date (YYYY-MM-DD) and treat it as UTC midnight.
  // This ignores time-of-day AND any timezone suffix, so sprints ending on the
  // same date always read identically — matching the backend's UTC parsing
  // (which is why a no-tz Jira string parsed via `new Date()` here could shift
  // a sprint's date by the browser's offset and split the counts).
  const ymd = (s?: string): number | null => {
    const m = (s || "").match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (!m) return null
    const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    return Number.isNaN(t) ? null : t
  }
  const start = ymd(startDate)
  const end = ymd(endDate)
  if (start === null || end === null) return null

  const now = new Date()
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())

  // Inclusive calendar-day span.
  const totalDays = Math.max(Math.floor((end - start) / DAY_MS) + 1, 1)
  if (today > end) {
    const daysOverdue = Math.max(1, Math.round((today - end) / DAY_MS))
    return `Overdue by ${daysOverdue} day${daysOverdue === 1 ? '' : 's'}`
  }
  const elapsed = Math.floor((today - start) / DAY_MS) + 1
  const day = Math.max(1, Math.min(elapsed, totalDays))
  return `Day ${day}/${totalDays}`
}

export const describeAiFallback = (reason?: string): string => {
  switch ((reason || '').toLowerCase()) {
    case 'not_configured':
      return '🔑 No AI provider is configured. Add your Gemini/OpenRouter API key in Settings to get AI-generated plans — showing a rule-based plan built from the detected risks meanwhile.'
    case 'busy':
      return '⏳ The AI was busy with another request, so this plan came from rule-based heuristics. Try again in a moment.'
    case 'timeout':
      return "⏱️ The AI didn't respond in time — showing a rule-based plan. Retrying usually works."
    case 'auth':
      return '🔑 The AI provider rejected the request — check your API key or quota in Settings. Showing a rule-based plan.'
    default:
      return '⚠️ AI unavailable right now — showing a rule-based plan built from the detected risks.'
  }
}
