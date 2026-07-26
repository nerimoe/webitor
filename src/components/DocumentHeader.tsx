import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Clock3, Download, FileText, Link2, MoreHorizontal, Save, SaveAll, Share2, X, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { canShareBlob, contentMediaBlob, shareBlob, shareTextFile } from '../lib/files'
import { createFileShareUrl, shareOrCopyFileUrl, ShareLinkError, type ShareLinkProgress } from '../lib/shareLink'
import { useWorkspace } from '../store/useWorkspace'
import { IconButton } from './IconButton'
import { TimelineDialog } from './TimelineDialog'
import { TransferStatus } from './TransferStatus'
import { useActionOverflow, type OverflowAction } from './useActionOverflow'

export interface HeaderAction extends OverflowAction {
  label: string
  icon: LucideIcon
  onClick: () => void
  active?: boolean
  value?: string | number
}

export function ActionToolbar({ actions, closeLabel, onClose }: {
  actions: HeaderAction[]
  closeLabel?: string
  onClose?: () => void
}) {
  const { t } = useTranslation()
  const { ref, visible, overflow } = useActionOverflow(actions, { fixedSlots: onClose ? 1 : 0 })
  const renderAction = (action: HeaderAction) => action.value !== undefined
    ? <Tooltip.Root key={action.id} delayDuration={450}>
      <Tooltip.Trigger asChild><button className="icon-button font-size-button" aria-label={action.label} onClick={action.onClick}>{action.value}</button></Tooltip.Trigger>
      <Tooltip.Portal><Tooltip.Content className="tooltip" sideOffset={6}>{action.label}</Tooltip.Content></Tooltip.Portal>
    </Tooltip.Root>
    : <IconButton key={action.id} icon={action.icon} label={action.label} active={action.active} onClick={action.onClick} />

  return <div ref={ref} className="editor-actions">
    {visible.map(renderAction)}
    {overflow.length > 0 && <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild><IconButton icon={MoreHorizontal} label={t('moreActions')} /></DropdownMenu.Trigger>
      <DropdownMenu.Portal><DropdownMenu.Content className="menu-content" align="end">
        {overflow.map((action) => {
          const Icon = action.icon
          return <DropdownMenu.Item key={action.id} className="menu-item with-icon" onSelect={action.onClick}><Icon size={18} />{action.label}</DropdownMenu.Item>
        })}
      </DropdownMenu.Content></DropdownMenu.Portal>
    </DropdownMenu.Root>}
    {onClose && closeLabel && <IconButton icon={X} label={closeLabel} className="pane-close" onPointerDown={(event) => {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }} onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onClose()
      }
    }} />}
  </div>
}

export function DocumentHeader({ fileId, leading, middle, viewActions = [], closeLabel, onClose, shared = false }: {
  fileId: string | null
  leading?: ReactNode
  middle?: ReactNode
  viewActions?: HeaderAction[]
  closeLabel?: string
  onClose?: () => void
  shared?: boolean
}) {
  const { t } = useTranslation()
  const node = useWorkspace((state) => fileId ? state.nodes[fileId] : undefined)
  const content = useWorkspace((state) => fileId ? state.contents[fileId] : undefined)
  const saveFile = useWorkspace((state) => state.saveFile)
  const renameNode = useWorkspace((state) => state.renameNode)
  const setNotice = useWorkspace((state) => state.setNotice)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const [shareProgress, setShareProgress] = useState<ShareLinkProgress | null>(null)
  const [generatedShareUrl, setGeneratedShareUrl] = useState<string | null>(null)
  const titleInput = useRef<HTMLInputElement>(null)
  const binary = Boolean(content && content.contentKind !== 'text')
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

  useEffect(() => {
    setRenaming(false)
    setDraftName(node?.name ?? '')
  }, [fileId, node?.name])
  useEffect(() => { if (renaming) titleInput.current?.focus() }, [renaming])

  const beginRename = () => {
    if (!node) return
    setDraftName(node.name)
    setRenaming(true)
  }
  const commitRename = () => {
    if (node && draftName.trim()) renameNode(node.id, draftName)
    setRenaming(false)
  }
  const createShareLink = async () => {
    if (!content || shareProgress) return
    const name = node?.name ?? (binary ? 'file' : 'document.txt')
    try {
      const url = await createFileShareUrl(
        { name, text: content.text, mediaBlob: content.mediaBlob, dataUrl: content.dataUrl, mimeType: content.mimeType, contentKind: content.contentKind },
        location.href,
        setShareProgress
      )
      setGeneratedShareUrl(url)
    } catch (error) {
      if (error instanceof ShareLinkError && error.code === 'tooLarge') setNotice('shareLinkTooLarge')
      else if (error instanceof ShareLinkError && error.code === 'rateLimited') setNotice('shareLinkRateLimited')
      else setNotice('shareLinkFailed')
    } finally {
      setShareProgress(null)
    }
  }
  const shareGeneratedLink = async () => {
    if (!generatedShareUrl) return
    const name = node?.name ?? (binary ? 'file' : 'document.txt')
    try {
      const result = await shareOrCopyFileUrl(generatedShareUrl, name)
      if (result === 'copied') setNotice('shareLinkCopied')
      setShareDialogOpen(false)
      setGeneratedShareUrl(null)
    } catch { setNotice('shareLinkFailed') }
  }

  const documentActions = useMemo<HeaderAction[]>(() => {
    if (!fileId || !content) return []
    const next: HeaderAction[] = []
    const name = node?.name ?? (binary ? 'file' : 'document.txt')
    const blob = binary ? contentMediaBlob(content) : new Blob([content.text], { type: 'text/plain' })
    const share = () => binary ? void shareBlob(blob, name) : void shareTextFile(content.text, name)
    if (!iOS) {
      next.push({ id: 'save', priority: 0, label: t(node?.handle ? 'save' : 'download'), icon: node?.handle ? Save : Download, onClick: () => void saveFile(fileId) })
      if (window.showSaveFilePicker) next.push({ id: 'save-as', priority: 7, label: t('saveAs'), icon: SaveAll, onClick: () => void saveFile(fileId, true) })
    }
    if (iOS || canShareBlob(blob, name)) next.push({ id: 'share', priority: iOS ? 0 : 2, label: t('share'), icon: Share2, onClick: share })
    next.push({ id: 'share-link', priority: 5, label: t('createShareLink'), icon: Link2, onClick: () => setShareDialogOpen(true) })
    if (content.contentKind === 'text') next.push({ id: 'timeline', priority: 6, label: t('timeline'), icon: Clock3, onClick: () => setTimelineOpen(true) })
    return next
  }, [binary, content, fileId, iOS, node?.handle, node?.name, saveFile, t])

  return <>
    <div className={`document-bar ${shared ? 'shared-document-bar' : ''}`} data-testid={shared ? 'shared-document-bar' : undefined}>
      {leading && <div className="document-leading">{leading}</div>}
      {node ? <div className="document-title">
        <FileText size={18} />
        {renaming ? <input ref={titleInput} className="title-rename" value={draftName} aria-label={t('renameFile')} onChange={(event) => setDraftName(event.target.value)} onBlur={commitRename} onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); commitRename() }
          if (event.key === 'Escape') { event.preventDefault(); setRenaming(false) }
        }} /> : <button className="title-button" onClick={beginRename} aria-label={t('renameFile')}><span>{node.name}</span></button>}
        {content?.status === 'saving' && <span className="dirty-dot" />}
      </div> : <div className="document-title no-document-title"><span>{t('noFileTitle')}</span></div>}
      {middle}
      {fileId && <ActionToolbar actions={[...viewActions, ...documentActions]} closeLabel={closeLabel} onClose={onClose} />}
    </div>
    {fileId && content?.contentKind === 'text' && <TimelineDialog fileId={fileId} open={timelineOpen} onOpenChange={setTimelineOpen} />}
    <Dialog.Root open={shareDialogOpen} onOpenChange={(open) => {
      if (shareProgress) return
      setShareDialogOpen(open)
      if (!open) setGeneratedShareUrl(null)
    }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content share-dialog" onEscapeKeyDown={(event) => { if (shareProgress) event.preventDefault() }} onPointerDownOutside={(event) => { if (shareProgress) event.preventDefault() }}>
          <Dialog.Title>{t(generatedShareUrl ? 'shareReadyTitle' : 'shareConfirmTitle')}</Dialog.Title>
          <Dialog.Description>{t(generatedShareUrl ? 'shareReadyBody' : 'shareConfirmBody')}</Dialog.Description>
          {shareProgress && <TransferStatus label={t(`sharePhase_${shareProgress.phase}`)} progress={shareProgress.progress} />}
          {generatedShareUrl && <input className="share-link-output" aria-label={t('generatedShareLink')} readOnly value={generatedShareUrl} onFocus={(event) => event.currentTarget.select()} />}
          <div className="dialog-actions">
            <Dialog.Close asChild><button className="secondary-button" disabled={Boolean(shareProgress)}>{t(generatedShareUrl ? 'close' : 'cancel')}</button></Dialog.Close>
            <button className="primary-button" disabled={Boolean(shareProgress)} onClick={() => void (generatedShareUrl ? shareGeneratedLink() : createShareLink())}>{t(generatedShareUrl ? 'shareCreatedLink' : shareProgress ? 'creatingShareLink' : 'confirmCreateShareLink')}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </>
}
