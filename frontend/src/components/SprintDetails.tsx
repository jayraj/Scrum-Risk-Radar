import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Bot, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useSnapshot } from '../hooks/useSnapshot'
import {
  apiGenerateFollowup,
  apiGenerateMitigations,
  SHOW_AI_DEBUG,
  type Blocker,
  type Mitigation,
} from '../api/client'
import {
  formatRiskType,
  riskDetected,
  riskStatusFor,
  riskTitle,
  severityColor,
  splitItems,
  sprintDayLabel,
} from '../utils/format'

interface SprintDetailsProps {
  syncIntervalSeconds: number
  refreshKey?: number
  sprintName?: string
  onBack?: () => void
}

const draftToPlainText = (html: string): string =>
  html
    .replace(/<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, url: string, label: string) => `${label} (${url})`)
    .replace(/<[^>]*>/g, '')

export default function SprintDetails({ syncIntervalSeconds, refreshKey = 0, sprintName, onBack }: SprintDetailsProps) {
  const { sprintKey } = useParams<{ sprintKey: string }>()
  const { snapshot, loading, error, noProfile } = useSnapshot(syncIntervalSeconds, refreshKey)

  const blockers = snapshot?.blockers ?? []
  const [mitigations, setMitigations] = useState<Mitigation[]>(snapshot?.mitigations ?? [])
  const [generating, setGenerating] = useState(false)
  const [draftingKey, setDraftingKey] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [draftGeneratedBy, setDraftGeneratedBy] = useState<Record<string, string>>({})
  const [activeTab, setActiveTab] = useState('ALL')
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  const resolvedName = sprintName ?? (sprintKey ? decodeURIComponent(sprintKey) : '')
  const card = snapshot?.radar_data.find((r) => r.sprint_key === resolvedName) ?? null
  const sprintBlockers = resolvedName ? blockers.filter((b) => b.sprint_key === resolvedName) : []
  const sprintMitigation = mitigations.find((m) => m.sprint_key === resolvedName) || null

  const generateMitigations = async () => {
    if (!resolvedName) return
    setGenerating(true)
    try {
      const response = await apiGenerateMitigations(resolvedName)
      setMitigations(response.mitigations)
    } catch (error) {
      console.error('Error generating mitigations:', error)
    } finally {
      setGenerating(false)
    }
  }

  const draftMessage = async (blocker: Blocker) => {
    const issueKey = blocker.issue_key
    if (!issueKey) return
    setDraftingKey(issueKey)
    try {
      const response = await apiGenerateFollowup(issueKey)
      setDrafts((prev) => ({ ...prev, [issueKey]: response.message || '' }))
      setDraftGeneratedBy((prev) => ({ ...prev, [issueKey]: response.generated_by || 'ai' }))
    } catch (error) {
      console.error('Error drafting message:', error)
      setDrafts((prev) => ({ ...prev, [issueKey]: 'Failed to generate message. Please try again.' }))
    } finally {
      setDraftingKey(null)
    }
  }

  const copyDraft = async (issueKey: string) => {
    const text = drafts[issueKey]
    if (!text) return
    try {
      await navigator.clipboard.writeText(draftToPlainText(text))
      alert('Message copied to clipboard!')
    } catch (error) {
      console.error('Copy failed:', error)
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
          <button className="breadcrumb-link-btn" onClick={onBack}>ACTIVE SPRINT(S)</button>
        ) : (
          <Link to="/">ACTIVE SPRINT(S)</Link>
        )}
        <span className="breadcrumb-sep">/</span>
        <span className="breadcrumb-current">{resolvedName}</span>
      </nav>

      <div className="blockers-panel">
        <div className="panel-heading">
          <div className="panel-heading-left">
            <h2 className="component-title"><ShieldAlert size={24} className="title-icon" />{resolvedName} Blockers &amp; Impediments</h2>
            {card && (
              <span className="risk-score" style={{ backgroundColor: severityColor(card.severity) }}>
                {card.risk_score}%
              </span>
            )}
          </div>
          <button className="ai-scan-btn" onClick={generateMitigations} disabled={generating}>
            <ShieldCheck size={16} />
            {generating ? 'Generating...' : 'Mitigate with AI'}
          </button>
        </div>

        {card && (
          <div className="sprint-detail-meta">
            <span>{card.sprint_key}</span>
            {sprintDayLabel(card.start_date, card.end_date) && (
              <span>{sprintDayLabel(card.start_date, card.end_date)}</span>
            )}
            <span>Progress {card.total_sp > 0 ? Math.round((card.completed_sp / card.total_sp) * 100) : 0}%</span>
            <span>{card.completed_sp} pt / {card.total_sp} pt</span>
          </div>
        )}

        {sprintBlockers.length === 0 ? (
          <div className="empty-cell">
            No risks found. The Sprint health looks good !!!
            {sprintMitigation && ' Review the AI Summary below for the next Actions.'}
          </div>
        ) : (
          <>
            <div className="risk-tabs">
              {[
                { key: 'ALL', label: 'All' },
                { key: 'CRITICAL', label: 'Critical' },
                { key: 'HIGH', label: 'High' },
                { key: 'MEDIUM', label: 'Medium' },
                { key: 'LOW', label: 'Low' },
              ].map((tab) => {
                const count =
                  tab.key === 'ALL'
                    ? sprintBlockers.length
                    : sprintBlockers.filter((b) => (b.severity || '').toUpperCase() === tab.key).length
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

            <div className="risk-table">
              <div className="risk-table-header">
                <span>Risk</span>
                <span>Category</span>
                <span>Detected</span>
                <span>Stories</span>
                <span>Status</span>
              </div>
              <div className="risk-table-rows">
                {(activeTab === 'ALL'
                  ? sprintBlockers
                  : sprintBlockers.filter((b) => (b.severity || '').toUpperCase() === activeTab)
                ).map((blocker) => {
                  const key = blocker.issue_key || `${blocker.type}-${blocker.sprint_key}-${blocker.summary || ''}`
                  const severity = (blocker.severity || '').toUpperCase()
                  const storyCount = blocker.issue_keys?.length ?? blocker.count ?? (blocker.issue_key ? 1 : 0)
                  const detect = riskDetected(blocker)
                  const status = riskStatusFor(blocker.severity)
                  const expanded = expandedKey === key
                  const showDraft = !!blocker.issue_key
                  return (
                    <div key={key} className="risk-row-wrap">
                      <button
                        className={`risk-row ${expanded ? 'selected' : ''}`}
                        onClick={() => setExpandedKey(expanded ? null : key)}
                      >
                        <div className="risk-row-main">
                          <span
                            className={`risk-dot ${severity === 'CRITICAL' || severity === 'MEDIUM' ? 'pulse' : ''}`}
                            style={{ backgroundColor: severityColor(blocker.severity) }}
                          />
                          <span className="risk-row-title">
                            <span className="blocker-key">{riskTitle(blocker)}</span>
                            {blocker.summary && blocker.summary !== riskTitle(blocker) && (
                              <span> {blocker.summary}</span>
                            )}
                          </span>
                        </div>
                        <span className="risk-row-cat">{formatRiskType(blocker.type)}</span>
                        <span className="risk-row-detect">{detect}</span>
                        <span className="risk-row-stories" style={{ color: severityColor(blocker.severity) }}>
                          {storyCount}pt
                        </span>
                        <span className="risk-row-status" style={{ color: status.color }}>
                          {status.label}
                        </span>
                      </button>
                      {expanded && (
                        <div className="risk-row-expand">
                          <div className="risk-mitigation">
                            <span className="risk-mitigation-label">⚡ AI MITIGATION STRATEGY</span>
                            <p>{blocker.recommendation || 'No recommendation available.'}</p>
                          </div>
                          {showDraft && (
                            <div className="risk-row-actions">
                              <button
                                className="draft-btn"
                                disabled={draftingKey === blocker.issue_key}
                                onClick={() => draftMessage(blocker)}
                              >
                                {draftingKey === blocker.issue_key ? 'Drafting...' : '💬 Draft Message'}
                              </button>
                            </div>
                          )}
                          {blocker.issue_key && drafts[blocker.issue_key] && (
                            <div className="draft-output">
                              <div className="draft-output-header">
                                <span>✍️ AI Follow-up Message</span>
                                <div className="draft-output-actions">
                                  <button className="copy-btn" onClick={() => copyDraft(blocker.issue_key!)}>📋 Copy</button>
                                </div>
                              </div>
                              <p
                                className="draft-text"
                                dangerouslySetInnerHTML={{ __html: drafts[blocker.issue_key] }}
                              />
                              <div className="fallback-note">Paste this into the Jira ticket as a comment.</div>
                              {draftGeneratedBy[blocker.issue_key] === 'rule-based' && (
                                <div className="fallback-note">
                                  ⚠️ Generated from available data (AI temporarily unavailable)
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
                {activeTab !== 'ALL' &&
                  sprintBlockers.filter((b) => (b.severity || '').toUpperCase() === activeTab).length === 0 && (
                    <div className="risk-table-empty">No {activeTab.toLowerCase()} risks in this sprint.</div>
                  )}
              </div>
            </div>
          </>
        )}

        {sprintMitigation && (
          <div className="mitigation-card">
            <h4 className="mitigation-title"><Bot size={20} className="title-icon" />AI MITIGATION PLAN</h4>

            {(sprintMitigation.risk_types ?? []).length > 0 && (
              <div className="risk-chips">
                {sprintMitigation.risk_types?.map((type) => (
                  <span key={type} className="risk-chip">
                    {formatRiskType(type)}
                    {type === 'BURNDOWN_BEHIND' && sprintMitigation.burndown_gap_percent !== undefined && sprintMitigation.burndown_gap_percent !== null && (
                      <> — {sprintMitigation.burndown_gap_percent}%</>
                    )}
                  </span>
                ))}
              </div>
            )}

            {sprintMitigation.action_items && sprintMitigation.action_items.length > 0 && (
              <div className="plan-section">
                <div className="plan-section-title">ACTION ITEMS</div>
                <ol className="plan-list">
                  {sprintMitigation.action_items.map((action, idx) => (
                    <li key={idx}>{action}</li>
                  ))}
                </ol>
              </div>
            )}

            {sprintMitigation.owner && (
              <div className="plan-section">
                <div className="plan-section-title">OWNER</div>
                <ul className="plan-list">
                  {splitItems(sprintMitigation.owner).map((item, idx) => (
                    <li key={`o${idx}`}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {sprintMitigation.timeline && (
              <div className="plan-section">
                <div className="plan-section-title">TIMELINE</div>
                <ul className="plan-list">
                  {splitItems(sprintMitigation.timeline).map((item, idx) => (
                    <li key={`t${idx}`}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {sprintMitigation.success_criteria && sprintMitigation.success_criteria.length > 0 && (
              <div className="plan-section">
                <div className="plan-section-title">SUCCESS CRITERIA</div>
                <ul className="plan-list">
                  {sprintMitigation.success_criteria.map((criterion, idx) => (
                    <li key={idx}>{criterion}</li>
                  ))}
                </ul>
              </div>
            )}

            {SHOW_AI_DEBUG && (
              <details className="prompt-details">
                <summary>🔍 View AI Prompt &amp; Raw Response</summary>
                {sprintMitigation.llm && (
                  <div className="ai-info-line">
                    <span>🤖 LLM: {sprintMitigation.llm.provider} · {sprintMitigation.llm.model}</span>
                    <span className={`ai-used ${sprintMitigation.ai_used ? 'yes' : 'no'}`}>
                      {sprintMitigation.ai_used ? 'AI used' : 'Rule-based fallback'}
                    </span>
                  </div>
                )}
                <div className="prompt-block">
                  <div className="prompt-label">Prompt sent to model:</div>
                  <pre>{sprintMitigation.prompt}</pre>
                  <div className="prompt-label">Model response:</div>
                  <pre>{sprintMitigation.raw_response || '⚠️ AI unavailable — used fallback (see error).'}</pre>
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  )
}