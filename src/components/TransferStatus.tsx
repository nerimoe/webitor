import { LoaderCircle } from 'lucide-react'

export function TransferStatus({ label, progress, className = '' }: {
  label: string
  progress?: number
  className?: string
}) {
  const percentage = progress === undefined ? null : Math.round(progress * 100)
  return <div className={`transfer-status ${className}`} role="status" aria-live="polite">
    <LoaderCircle className="spin" size={19} />
    <span>{label}{percentage === null ? '' : ` ${percentage}%`}</span>
    {percentage !== null && <div className="transfer-progress" aria-hidden="true"><span style={{ width: `${percentage}%` }} /></div>}
  </div>
}
