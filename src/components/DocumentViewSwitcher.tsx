import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, Columns2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DocumentViewProvider } from '../documentFormats/types'
import { IconButton } from './IconButton'

export function DocumentViewSwitcher({ views, activeViewId, splitCandidates, unavailableViewIds = [], onSelect, onSplit }: {
  views: DocumentViewProvider[]
  activeViewId: string
  splitCandidates: DocumentViewProvider[]
  unavailableViewIds?: string[]
  onSelect: (viewId: string) => void
  onSplit: (viewId: string) => void
}) {
  const { t } = useTranslation()
  if (views.length < 2) return null
  const activeView = views.find((view) => view.id === activeViewId)
  if (!activeView) throw new Error(`Active document view is unavailable: ${activeViewId}`)
  const unavailable = new Set(unavailableViewIds)
  const selectableViews = views.filter((view) => view.id === activeViewId || !unavailable.has(view.id))
  const canChangeView = selectableViews.length > 1

  const providerItems = selectableViews.map((view) => <DropdownMenu.Item key={view.id} className="menu-item view-provider-item" onSelect={() => onSelect(view.id)}>
    <span>{t(view.labelKey)}</span>{view.id === activeViewId && <Check size={17} />}
  </DropdownMenu.Item>)

  return <div className="document-view-controls">
    {canChangeView ? <div className="view-mode-tabs" role="tablist" aria-label={t('documentViews')}>
      {selectableViews.map((view) => <button key={view.id} role="tab" aria-selected={view.id === activeViewId} className={view.id === activeViewId ? 'active' : ''} onClick={() => onSelect(view.id)}>{t(view.labelKey)}</button>)}
    </div> : <div className="view-mode-label" aria-label={t('documentViews')}>{t(activeView.labelKey)}</div>}
    {canChangeView && <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild><button className="view-mode-select" aria-label={t('documentViews')}><span>{t(activeView.labelKey)}</span><ChevronDown size={16} /></button></DropdownMenu.Trigger>
      <DropdownMenu.Portal><DropdownMenu.Content className="menu-content view-provider-menu" align="start">{providerItems}</DropdownMenu.Content></DropdownMenu.Portal>
    </DropdownMenu.Root>}
    {splitCandidates.length === 1 && <IconButton icon={Columns2} label={t('showSideBySide')} className="view-split-button" onClick={() => onSplit(splitCandidates[0].id)} />}
    {splitCandidates.length > 1 && <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild><IconButton icon={Columns2} label={t('showSideBySide')} className="view-split-button" /></DropdownMenu.Trigger>
      <DropdownMenu.Portal><DropdownMenu.Content className="menu-content view-provider-menu" align="end">
        {splitCandidates.map((view) => <DropdownMenu.Item key={view.id} className="menu-item" onSelect={() => onSplit(view.id)}>{t(view.labelKey)}</DropdownMenu.Item>)}
      </DropdownMenu.Content></DropdownMenu.Portal>
    </DropdownMenu.Root>}
  </div>
}
