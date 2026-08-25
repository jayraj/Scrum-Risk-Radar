import { AlertCircle } from 'lucide-react'
import { riskTitle, describeAiFallback } from '../utils/format'
import type { Blocker } from '../api/client'

interface RiskCardItemProps {
  blocker: Blocker
  showDraft?: boolean
  showCategory?: boolean
  drafting?: boolean
  onDraft?: () => void
  draft?: string
  generatedBy?: string
  fallbackReason?: string
  onCopy?: () => void
}

const SEVERITY_CLASS: Record<string, string> = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
}

export default function RiskCardItem({
  blocker,
  showDraft,
  showCategory,
  drafting,
  onDraft,
  draft,
  generatedBy,
  fallbackReason,
  onCopy,
}: RiskCardItemProps) {
  const severity = (blocker.severity || 'MEDIUM').toUpperCase()
  const sevClass = SEVERITY_CLASS[severity] || 'medium'
  const title = riskTitle(blocker)
  const description = blocker.recommendation || blocker.summary || 'No recommendation available.'
  const categoryLabel = blocker.type ? blocker.type.toLowerCase().replace(/_/g, ' ') : ''
  const issueKey = blocker.issue_key

  return (
    <div className={`risk-card-item ${sevClass}`}>
      <div className="risk-card-item-header">
        <AlertCircle size={12} className="risk-card-item-icon" />
        <span className="risk-card-item-sev">
          {severity.toLowerCase()}
          {showCategory && categoryLabel ? `: ${categoryLabel}` : ''}
        </span>
      </div>
      <p className="risk-card-item-title">{title}</p>
      <p className="risk-card-item-desc">{description}</p>

      {showDraft && issueKey && (
        <button className="draft-btn" disabled={drafting} onClick={onDraft}>
          {drafting ? 'Drafting...' : '💬 Draft Message'}
        </button>
      )}

      {issueKey && draft && (
        <div className="draft-output">
          <div className="draft-output-header">
            <span>✍️ AI Follow-up Message</span>
            <div className="draft-output-actions">
              <button className="copy-btn" onClick={onCopy}>📋 Copy</button>
            </div>
          </div>
          <p className="draft-text" dangerouslySetInnerHTML={{ __html: draft }} />
          <div className="fallback-note">Paste this into the Jira ticket as a comment.</div>
          {generatedBy === 'rule-based' && (
            <div className="fallback-note">{describeAiFallback(fallbackReason || '')}</div>
          )}
        </div>
      )}
    </div>
  )
}
