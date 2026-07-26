import { useCallback, useMemo, useRef, type ReactNode } from 'react'
import { FilePlus2, Redo2, RotateCcw, Search, Undo2, Upload, ZoomIn, ZoomOut } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { resolveDocumentViews } from '../documentFormats/registry'
import type { DocumentViewController } from '../documentFormats/types'
import { useWorkspace } from '../store/useWorkspace'
import type { EditorGroup } from '../types'
import { ActionToolbar, DocumentHeader, type HeaderAction } from './DocumentHeader'
import { DocumentStatusBar } from './DocumentStatusBar'
import { DocumentSurface } from './DocumentSurface'
import { DocumentViewSwitcher } from './DocumentViewSwitcher'

interface EditorPaneProps {
  group: EditorGroup
  leading?: ReactNode
  onNewDocument?: () => void
  onImportFiles?: () => void
  viewOnlyHeader?: boolean
}

const DEFAULT_EDITOR_FONT_SIZE = 16

export function EditorPane({ group, leading, onNewDocument, onImportFiles, viewOnlyHeader = false }: EditorPaneProps) {
  const { t } = useTranslation()
  const nodes = useWorkspace((state) => state.nodes)
  const contents = useWorkspace((state) => state.contents)
  const groups = useWorkspace((state) => state.layout.groups)
  const updateContent = useWorkspace((state) => state.updateContent)
  const setGroupView = useWorkspace((state) => state.setGroupView)
  const openFileView = useWorkspace((state) => state.openFileView)
  const closeGroup = useWorkspace((state) => state.closeGroup)
  const editorFontSize = useWorkspace((state) => state.layout.editorFontSize)
  const setEditorFontSize = useWorkspace((state) => state.setEditorFontSize)
  const viewController = useRef<DocumentViewController | null>(null)
  const fileId = group.activeFileId
  const node = fileId ? nodes[fileId] : undefined
  const content = fileId ? contents[fileId] : undefined
  const resolution = node && content ? resolveDocumentViews({ name: node.name, mimeType: content.mimeType, contentKind: content.contentKind }) : null
  const activeView = resolution?.views.find((view) => view.id === group.view) ?? resolution?.views[0] ?? null
  const otherGroup = groups.find((candidate) => candidate.id !== group.id)
  const splitCandidates = resolution?.views.filter((view) => view.id !== activeView?.id
    && !(otherGroup?.activeFileId === fileId && otherGroup.view === view.id)) ?? []
  const splitActive = Boolean(groups[1].activeFileId)

  const registerController = useCallback((controller: DocumentViewController | null) => {
    viewController.current = controller
  }, [])
  const closePane = () => {
    if (fileId) closeGroup(group.id)
  }

  const viewActions = useMemo<HeaderAction[]>(() => {
    if (!fileId || !content || !activeView) return []
    const next: HeaderAction[] = []
    if (activeView.capabilities.textEditing) {
      next.push({ id: 'undo', priority: 0, label: t('undo'), icon: Undo2, onClick: () => viewController.current?.undo?.() })
      next.push({ id: 'redo', priority: 1, label: t('redo'), icon: Redo2, onClick: () => viewController.current?.redo?.() })
    }
    if (activeView.capabilities.find) next.push({ id: 'search', priority: 2, label: t('search'), icon: Search, onClick: () => viewController.current?.find?.() })
    if (activeView.capabilities.textZoom) {
      next.push({ id: 'zoom-out', priority: 4, label: t('decreaseTextSize'), icon: ZoomOut, onClick: () => setEditorFontSize(editorFontSize - 1) })
      next.push({ id: 'font-size', priority: 3, label: t('resetTextSize', { size: editorFontSize }), icon: RotateCcw, value: editorFontSize, onClick: () => setEditorFontSize(DEFAULT_EDITOR_FONT_SIZE) })
      next.push({ id: 'zoom-in', priority: 5, label: t('increaseTextSize'), icon: ZoomIn, onClick: () => setEditorFontSize(editorFontSize + 1) })
    }
    return next
  }, [activeView, content, editorFontSize, fileId, setEditorFontSize, t])

  const viewSwitcher = fileId && activeView && resolution ? <DocumentViewSwitcher
    views={resolution.views}
    activeViewId={activeView.id}
    splitCandidates={splitCandidates}
    onSelect={(viewId) => setGroupView(group.id, viewId)}
    onSplit={(viewId) => openFileView(fileId, group.id === 'primary' ? 'secondary' : 'primary', viewId)}
  /> : null
  const closeLabel = splitActive ? t('closePane') : t('closeFile')

  return <section className={`editor-pane ${content && !viewOnlyHeader ? 'has-status-bar' : ''} ${viewOnlyHeader ? 'view-only-pane' : ''}`} data-testid={`editor-${group.id}`} onDragOver={(event) => {
    if (event.dataTransfer.types.includes('Files')) event.preventDefault()
  }}>
    {viewOnlyHeader
      ? <div className="pane-view-bar" data-testid={`view-bar-${group.id}`}>
        {viewSwitcher}
        {fileId && <ActionToolbar actions={viewActions} closeLabel={closeLabel} onClose={closePane} />}
      </div>
      : <DocumentHeader fileId={fileId} leading={leading} middle={viewSwitcher} viewActions={viewActions} closeLabel={fileId ? closeLabel : undefined} onClose={fileId ? closePane : undefined} />}
    {!fileId || !node || !content || !activeView ? <div className="no-file-state" data-testid="no-file-state">
      <div className="empty-symbol">Aa</div><h1>{t('noFileTitle')}</h1><p>{t('noFileBody')}</p>
      <div className="empty-actions"><button className="primary-button" onClick={onNewDocument}><FilePlus2 size={18} />{t('newFile')}</button><button className="secondary-button" onClick={onImportFiles}><Upload size={18} />{t('importFiles')}</button></div>
    </div> : <DocumentSurface view={activeView} fileId={fileId} node={node} content={content} updateText={(value) => updateContent(fileId, value)} registerController={registerController} />}
    {fileId && content && !viewOnlyHeader && <DocumentStatusBar fileId={fileId} />}
  </section>
}
