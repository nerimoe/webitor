import type { LucideIcon } from 'lucide-react'
import * as Tooltip from '@radix-ui/react-tooltip'

export function IconButton({ icon: Icon, label, active, className = '', ...props }: {
  icon: LucideIcon
  label: string
  active?: boolean
  className?: string
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Tooltip.Root delayDuration={450}>
      <Tooltip.Trigger asChild>
        <button className={`icon-button ${active ? 'active' : ''} ${className}`} aria-label={label} {...props}>
          <Icon size={18} strokeWidth={1.8} />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal><Tooltip.Content className="tooltip" sideOffset={6}>{label}</Tooltip.Content></Tooltip.Portal>
    </Tooltip.Root>
  )
}
