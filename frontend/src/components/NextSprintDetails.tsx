import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Calendar, Layers, RefreshCw, ShieldAlert } from 'lucide-react'
import { useSnapshot } from '../hooks/useSnapshot'
import {
  apiNextSprintIssues,
  apiNextSprintRisks,
  SHOW_AI_DEBUG,
  type Blocker,
  type NextSprintIssue,
  type NextSprintProject,
} from '../api/client'
import {
  formatDate,
  sprintDayLabel,
} from '../utils/format'
import SprintGauge from './SprintGauge'
import RiskCardItem from './RiskCardItem'
import WorkItemTable from './WorkItemTable'

interface NextSprintDetailsProps {
  project: NextSprintProject
  onBack?: () => void
  syncIntervalSeconds: number
  refreshKey?: number
}

export default function NextSprintDetails({ project, onBack, syncIntervalSeconds, refreshKey = 0 }: NextSprintDetailsProps) {
  const { loading, error, noProfile } = useSnapshot(syncIntervalSeconds, refreshKey)

  const [issues, setIssues] = useState<NextSprintIssue[]>([])
  const [nextSprintRisks, setNextSprintRisks] = useState<Blocker[] | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [aiPrompt, setAiPrompt] = useState<string | null>(null)
  const [aiRawResponse, setAiRawResponse] = useState<string | null>(null)
  const [aiUsed, setAiUsed] = useState(false)
  const [llmInfo, setLlmInfo] = useState<{ provider?: string; model?: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    if (project && project.issue_count > 0) {
      apiNextSprintIssues(project.project_key)
        .then((details) => {
          if (!cancelled) setIssues(details.issues)
        })
        .catch((error) => console.error('Error loading issues:', error))
    }
    return () => {
      cancelled = true
    }
  }, [project])

  const analyzeRisks = async () => {
    setAnalyzing(true)
    setAiPrompt(null)
    setAiRawResponse(null)
    try {
      const response = await apiNextSprintRisks(project.project_key)
      setNextSprintRisks((response.risks || []).sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0)))
      setAiPrompt(response.prompt || null)
      setAiRawResponse(response.raw_response || '')
      setAiUsed(!!response.ai_used)
      setLlmInfo(response.llm || null)
    } catch (error) {
      console.error('Error analyzing next sprint risks:', error)
      setNextSprintRisks([])
    } finally {
      setAnalyzing(false)
    }
  }

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

  return (
    <div className="sprint-details">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Dashboard</Link>
        <span className="breadcrumb-sep">/</span>
        {onBack ? (
          <button className="breadcrumb-link-btn" onClick={onBack}>FUTURE SPRINT(S)</button>
        ) : (
          <Link to="/">FUTURE SPRINT(S)</Link>
        )}
        <span className="breadcrumb-sep">/</span>
        <span className="breadcrumb-current">{project.sprint_key}</span>
      </nav>

      <div className="blockers-panel">
        <div className="panel-heading">
          <div className="panel-heading-left">
            <div className="sprint-card-head sprint-card-head--bare">
              <span className="sprint-card-eyebrow">UPCOMING SPRINT</span>
              <div className="sprint-card-head-row">
                <span className="sprint-card-name">{project.sprint_key}</span>
                {sprintDayLabel(project.start_date, project.end_date) && (
                  <span className="sprint-card-day">{sprintDayLabel(project.start_date, project.end_date)}</span>
                )}
              </div>
            </div>
          </div>
          <div className="panel-heading-actions">
            <SprintGauge score={project.risk_score} />
          </div>
        </div>

        <div className="sprint-detail-meta">
              <span>
                <Calendar size={13} className="sprint-meta-icon" />
            {project.start_date && project.end_date
              ? `${formatDate(project.start_date)} → ${formatDate(project.end_date)}`
              : project.start_date
                ? formatDate(project.start_date)
                : ''}
          </span>
        </div>

        <div className="panel-action-bar">
          <button className="ai-scan-btn" onClick={analyzeRisks} disabled={analyzing}>
            <RefreshCw size={16} />
            {analyzing ? 'Analyzing...' : 'SCAN WITH AI'}
          </button>
        </div>

        {nextSprintRisks !== null && (
          nextSprintRisks.length === 0 ? (
            <div className="empty-cell">✅ No early risks detected. Sprint is ready for planning.</div>
          ) : (
            <section className="detail-section">
              <div className="section-head">
                <ShieldAlert size={13} className="section-head-icon" style={{ color: '#ef4444' }} />
                <h2 className="section-head-title">Risks Identified</h2>
                <span className="section-count" style={{ background: 'var(--badge-critical-bg)', color: 'var(--badge-critical-text)' }}>
                  {nextSprintRisks.length}
                </span>
              </div>
              <div className="risk-card-list">
                {nextSprintRisks.map((risk, i) => (
                  <RiskCardItem key={risk.issue_key || `${risk.type}-${risk.sprint_key}-${i}`} blocker={risk} />
                ))}
              </div>
            </section>
          )
        )}

        {issues.length > 0 && (
          <section className="detail-section">
            <div className="section-head">
              <Layers size={13} className="section-head-icon" style={{ color: 'var(--color-indigo-500)' }} />
              <h2 className="section-head-title">Planned Work Items</h2>
              <span className="section-count" style={{ background: 'var(--color-indigo-50)', color: 'var(--color-indigo-600)' }}>
                {issues.length}
              </span>
              <span className="details-pts-total">{project.total_sp} pts total</span>
            </div>
            <div className="work-item-list">
              <WorkItemTable items={issues} />
            </div>
          </section>
        )}

        {SHOW_AI_DEBUG && aiPrompt !== null && (
          <div className="ai-details-section">
            <details className="ai-details">
              <summary>🔍 View AI Prompt &amp; Raw Response</summary>
              {llmInfo && (
                <div className="ai-info-line">
                  <span>🤖 LLM: {llmInfo.provider} · {llmInfo.model}</span>
                  <span className={`ai-used ${aiUsed ? 'yes' : 'no'}`}>
                    {aiUsed ? 'AI used' : 'Rule-based fallback'}
                  </span>
                </div>
              )}
              <div className="ai-detail-block">
                <div className="ai-detail-title">Prompt</div>
                <pre className="ai-detail-pre">{aiPrompt}</pre>
              </div>
              <div className="ai-detail-block">
                <div className="ai-detail-title">Raw Response</div>
                <pre className="ai-detail-pre">{aiRawResponse}</pre>
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  )
}
