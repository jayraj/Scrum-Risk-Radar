import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardList, RefreshCw } from 'lucide-react'
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
  formatRiskType,
  getRiskColor,
  riskStatusFor,
  severityColor,
} from '../utils/format'

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
  const [activeTab, setActiveTab] = useState('ALL')
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

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

  const summaryByKey = new Map(issues.map((issue) => [issue.key, issue.summary]))
  const assigneeByKey = new Map(issues.map((issue) => [issue.key, issue.assignee]))

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
        <Link to="/">Home</Link>
        <span className="breadcrumb-sep">/</span>
        {onBack ? (
          <button className="breadcrumb-link-btn" onClick={onBack}>FUTURE SPRINT(S)</button>
        ) : (
          <Link to="/">FUTURE SPRINT(S)</Link>
        )}
        <span className="breadcrumb-sep">/</span>
        <span className="breadcrumb-current">{project.sprint_key}</span>
      </nav>

      <div className={`sprint-details-header risk-card indigo`}>
        <div className="risk-header">
          <span className="issue-key">{project.project_key}</span>
          <span className="risk-score" style={{ backgroundColor: getRiskColor(project.risk_score) }}>
            {project.risk_score !== undefined && project.risk_score !== null ? project.risk_score : 'N/A'}%
          </span>
        </div>

        <div className="risk-body">
          <p className="summary">
            {project.sprint_key}
            {project.start_date && project.end_date && (
              <span className="sprint-dates">
                {' '}· {formatDate(project.start_date)} → {formatDate(project.end_date)}
              </span>
            )}
          </p>
          <p className="risk-type">{project.issue_count} issue(s) planned</p>
          <p className="sprint-meta">{project.total_sp} story points</p>
        </div>

        <div className="risk-footer">
          <div className="issue-types">
            {Object.entries(project.issue_types).map(([type, count]) => (
              <span key={type} className="type-chip">{type}: {count}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="blockers-panel">
        <div className="panel-heading">
          <h2 className="component-title"><ClipboardList size={24} className="title-icon" />Sprint Readiness</h2>
          <button className="ai-scan-btn" onClick={analyzeRisks} disabled={analyzing}>
            <RefreshCw size={11} />
            {analyzing ? 'Analyzing...' : 'RUN AI SCAN'}
          </button>
        </div>
        <p className="sprint-readiness-meta">Planned Stories : {project.issue_count}</p>

        {nextSprintRisks && nextSprintRisks.length > 0 && (() => {
            const categories = Array.from(new Set(nextSprintRisks.map((r) => r.type)))
            const ticketRows = nextSprintRisks.flatMap((risk) => {
              const keys = risk.issue_keys?.length ? risk.issue_keys : risk.issue_key ? [risk.issue_key] : []
              if (!keys.length) return [{ risk, ticketKey: risk.sprint_key || risk.type }]
              return keys.map((ticketKey) => ({ risk, ticketKey }))
            })
            const filteredRows =
              activeTab === 'ALL' ? ticketRows : ticketRows.filter((tr) => tr.risk.type === activeTab)
            return (
          <div>
            <div className="risk-summary">⚠️ {nextSprintRisks.length} early risk(s) found before planning</div>

            <div className="risk-tabs">
              {[
                { key: 'ALL', label: 'All' },
                ...categories.map((c) => ({ key: c, label: formatRiskType(c) })),
              ].map((tab) => {
                const count =
                  tab.key === 'ALL'
                    ? nextSprintRisks.length
                    : nextSprintRisks.filter((r) => r.type === tab.key).length
                return (
                  <button
                    key={tab.key}
                    className={`risk-tab ${activeTab === tab.key ? 'active' : ''}`}
                    onClick={() => setActiveTab(tab.key)}
                  >
                    {tab.label} ({count})
                  </button>
                )
              })}
            </div>

            <div className="risk-table six-col">
              <div className="risk-table-header">
                <span>Risk</span>
                <span>Category</span>
                <span>Severity</span>
                <span>Assignee</span>
                <span>Stories</span>
                <span>Status</span>
              </div>
              <div className="risk-table-rows">
                {filteredRows.map(({ risk, ticketKey }) => {
                  const key = `${risk.type}-${ticketKey}`
                  const severity = (risk.severity || '').toUpperCase()
                  const assignee = assigneeByKey.get(ticketKey) || risk.assignee || '—'
                  const status = riskStatusFor(risk.severity)
                  const expanded = expandedKey === key
                  return (
                    <div key={key} className="risk-row-wrap">
                      <button
                        className={`risk-row ${expanded ? 'selected' : ''}`}
                        onClick={() => setExpandedKey(expanded ? null : key)}
                      >
                        <div className="risk-row-main">
                          <span
                            className={`risk-dot ${severity === 'CRITICAL' || severity === 'MEDIUM' ? 'pulse' : ''}`}
                            style={{ backgroundColor: severityColor(risk.severity) }}
                          />
                          <span className="risk-row-title">
                            <span className="blocker-key">{ticketKey}</span>
                            <span className="risk-row-summary">{summaryByKey.get(ticketKey) || ''}</span>
                          </span>
                        </div>
                        <span className="risk-row-cat">{formatRiskType(risk.type)}</span>
                        <span className="risk-row-sev" style={{ color: severityColor(risk.severity) }}>
                          {severity}
                        </span>
                        <span className="risk-row-detect">{assignee}</span>
                        <span className="risk-row-stories" style={{ color: severityColor(risk.severity) }}>
                          1
                        </span>
                        <span className="risk-row-status" style={{ color: status.color }}>
                          {status.label}
                        </span>
                      </button>
                      {expanded && (
                        <div className="risk-row-expand">
                          <div className="risk-mitigation">
                            <span className="risk-mitigation-label">⚡ AI MITIGATION STRATEGY</span>
                            <p>{risk.recommendation || 'No recommendation available.'}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
                {filteredRows.length === 0 && (
                  <div className="risk-table-empty">No {formatRiskType(activeTab)} risks in this sprint.</div>
                )}
              </div>
            </div>
          </div>
          )
          })()}

        {!analyzing && nextSprintRisks !== null && nextSprintRisks.length === 0 && (
          <div className="empty-cell">✅ No early risks detected. Sprint is ready for planning.</div>
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