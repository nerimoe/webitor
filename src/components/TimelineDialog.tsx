import { useEffect, useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Clock3, RotateCcw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWorkspace } from '../store/useWorkspace'
import type { FileRevision } from '../types'

const emptyRevisions: FileRevision[] = []

export function TimelineDialog({ fileId, trigger, open: controlledOpen, onOpenChange }: { fileId: string; trigger?: ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const { t, i18n } = useTranslation()
  const revisions = useWorkspace((state) => state.revisions[fileId] ?? emptyRevisions)
  const restoreRevision = useWorkspace((state) => state.restoreRevision)
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = onOpenChange ?? setUncontrolledOpen
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const ordered = [...revisions].reverse()
  const selected = revisions.find((revision) => revision.id === selectedId) ?? ordered[0]
  useEffect(() => { if (open) setSelectedId(ordered[0]?.id ?? null) }, [open, revisions.length])
  const formatter = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })

  return <Dialog.Root open={open} onOpenChange={setOpen}>
    {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
    <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="timeline-dialog">
      <div className="timeline-heading"><div><Dialog.Title>{t('timeline')}</Dialog.Title><Dialog.Description>{t('timelineDescription')}</Dialog.Description></div><Dialog.Close asChild><button aria-label={t('close')}><X size={20} /></button></Dialog.Close></div>
      <div className="timeline-body">
        <div className="timeline-list">{ordered.length ? ordered.map((revision) => <button key={revision.id} className={revision.id === selected?.id ? 'selected' : ''} onClick={() => setSelectedId(revision.id)}><Clock3 size={17} /><span><strong>{formatter.format(revision.createdAt)}</strong><small>{t('versionNumber', { version: revision.version })}</small></span></button>) : <div className="timeline-empty">{t('timelineEmpty')}</div>}</div>
        <pre className="timeline-preview">{selected?.text ?? ''}</pre>
      </div>
      <div className="timeline-actions"><Dialog.Close asChild><button className="secondary-button">{t('close')}</button></Dialog.Close><button className="primary-button" disabled={!selected} onClick={() => { if (selected) restoreRevision(fileId, selected.id); setOpen(false) }}><RotateCcw size={18} />{t('restore')}</button></div>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>
}
