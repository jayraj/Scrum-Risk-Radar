interface SectionHeaderProps {
  title: string
  count?: number
  status?: {
    label: string
    tone?: 'green' | 'amber' | 'slate'
  }
}

export default function SectionHeader({ title, count, status }: SectionHeaderProps) {
  const statusTone = status?.tone ?? 'slate'

  return (
    <div className="section-header">
      <h2 className="section-header-title">{title}</h2>
      {count !== undefined && <span className="section-count-badge">{count}</span>}
      {status && <span className={`section-status-badge ${statusTone}`}>{status.label}</span>}
      <div className="section-header-divider" />
    </div>
  )
}
