import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Calendar, Layers, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useSnapshot } from '../hooks/useSnapshot'
import {
  apiGenerateFollowup,
  apiGenerateMitigations,
  SHOW_AI_DEBUG,
  type Blocker,
  type Mitigation,
} from '../api/client'
import {
  describeAiFallback,
  formatDate,
  formatRiskType,
  splitItems,
  sprintDayLabel,
} from '../utils/format'
import SprintGauge from './SprintGauge'
import RiskCardItem from './RiskCardItem'
import WorkItemTable from './WorkItemTable'

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
  const [draftFallbackReasons, setDraftFallbackReasons] = useState<Record<string, string>>({})
  const [planRequestedFor, setPlanRequestedFor] = useState<string | null>(null)

  const resolvedName = sprintName ?? (sprintKey ? decodeURIComponent(sprintKey) : '')
  const card = snapshot?.radar_data.find((r) => r.sprint_key === resolvedName) ?? null
  const sprintBlockers = resolvedName ? blockers.filter((b) => b.sprint_key === resolvedName) : []
  const sprintMitigation = mitigations.find((m) => m.sprint_key === resolvedName) || null
  const planVisible = !!resolvedName && planRequestedFor === resolvedName
  const sprintDataEntry = resolvedName
    ? Object.values(snapshot?.sprint_data ?? {}).find((d) => d.sprint?.name === resolvedName)
    : undefined
  const sprintIssues = sprintDataEntry?.issues ?? []

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
      const response = await apiGenerateFollowup(issueKey, blocker)
      setDrafts((prev) => ({ ...prev, [issueKey]: response.message || '' }))
      setDraftGeneratedBy((prev) => ({ ...prev, [issueKey]: response.generated_by || 'ai' }))
      setDraftFallbackReasons((prev) => ({ ...prev, [issueKey]: response.fallback_reason || '' }))
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
            {card ? (
              <div className="sprint-card-head sprint-card-head--bare">
                <span className="sprint-card-eyebrow">ACTIVE SPRINT</span>
                <div className="sprint-card-head-row">
                  <span className="sprint-card-name">{resolvedName}</span>
                  {sprintDayLabel(card.start_date, card.end_date) && (
                    <span className="sprint-card-day">{sprintDayLabel(card.start_date, card.end_date)}</span>
                  )}
                </div>
              </div>
            ) : (
              <h2 className="component-title"><ShieldAlert size={24} className="title-icon" />{resolvedName}</h2>
            )}
          </div>
          <div className="panel-heading-actions">
            {card && <SprintGauge score={card.risk_score} />}
          </div>
        </div>

        {card && (
          <>
            <div className="sprint-detail-meta">
              <span>
                <Calendar size={13} className="sprint-meta-icon" />
                {card.start_date && card.end_date
                  ? `${formatDate(card.start_date)} → ${formatDate(card.end_date)}`
                  : card.start_date
                    ? formatDate(card.start_date)
                    : ''}
              </span>
            </div>
          </>
        )}

        <div className="panel-action-bar">
          <button
            className="ai-scan-btn"
            onClick={() => {
              setPlanRequestedFor(resolvedName)
              generateMitigations()
            }}
            disabled={generating}
          >
            <ShieldCheck size={16} />
            {generating ? 'Generating...' : 'Mitigation Plan with AI'}
          </button>
        </div>

        {sprintBlockers.length === 0 ? (
          <div className="empty-cell">
            No risks found. The Sprint health looks good !!!
            {planVisible && sprintMitigation && ' Review the AI Summary below for the next Actions.'}
          </div>
        ) : (
          <section className="detail-section">
            <div className="section-head">
              <ShieldAlert size={13} className="section-head-icon" style={{ color: '#ef4444' }} />
              <h2 className="section-head-title">Risks Identified</h2>
              <span className="section-count" style={{ background: 'var(--badge-critical-bg)', color: 'var(--badge-critical-text)' }}>
                {sprintBlockers.length}
              </span>
            </div>
            <div className="risk-card-list">
              {sprintBlockers.map((blocker) => {
                const key = blocker.issue_key || `${blocker.type}-${blocker.sprint_key}-${blocker.summary || ''}`
                return (
                  <RiskCardItem
                    key={key}
                    blocker={blocker}
                    showDraft={!!blocker.issue_key}
                    drafting={draftingKey === blocker.issue_key}
                    onDraft={() => draftMessage(blocker)}
                    draft={blocker.issue_key ? drafts[blocker.issue_key] : undefined}
                    generatedBy={blocker.issue_key ? draftGeneratedBy[blocker.issue_key] : undefined}
                    fallbackReason={blocker.issue_key ? draftFallbackReasons[blocker.issue_key] : undefined}
                    onCopy={() => blocker.issue_key && copyDraft(blocker.issue_key)}
                  />
                )
              })}
            </div>
          </section>
        )}

        {sprintIssues.length > 0 && (
          <section className="detail-section">
            <div className="section-head">
              <Layers size={13} className="section-head-icon" style={{ color: 'var(--color-indigo-500)' }} />
              <h2 className="section-head-title">Planned Work Items</h2>
              <span className="section-count" style={{ background: 'var(--color-indigo-50)', color: 'var(--color-indigo-600)' }}>
                {sprintIssues.length}
              </span>
              <span className="details-pts-total">{card?.total_sp ?? 0} pts total</span>
            </div>
            <div className="work-item-list">
              <WorkItemTable items={sprintIssues} />
            </div>
          </section>
        )}

        {planVisible && sprintMitigation && (
          <div className="mitigation-card">
            {sprintMitigation.ai_used === false && (
              <div className="ai-fallback-note">
                {describeAiFallback(sprintMitigation.fallback_reason)}
              </div>
            )}
            <h4 className="mitigation-title"><ShieldCheck size={20} className="title-icon" />AI MITIGATION PLAN</h4>

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
