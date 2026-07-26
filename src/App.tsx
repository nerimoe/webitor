import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels'
import * as Dialog from '@radix-ui/react-dialog'
import * as Tooltip from '@radix-ui/react-tooltip'
import { FilePlus2, FolderInput, Menu, PanelLeft, PanelLeftOpen, Upload, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { collectDirectory, collectDroppedItems } from './lib/files'
import { cleanFileShareUrl, hasFileShareMarker, readFileShareUrl, ShareLinkError } from './lib/shareLink'
import { useWorkspace } from './store/useWorkspace'
import type { EditorGroup } from './types'
import { useImportWorkflow, type ImportItem, type ImportTarget } from './hooks/useImportWorkflow'
import { EditorPane } from './components/EditorPane'
import { IconButton } from './components/IconButton'
import { Sidebar } from './components/Sidebar'
import { EditorDropZones, WorkspaceDndProvider } from './components/WorkspaceDnd'

const SIDEBAR_COLLAPSE_THRESHOLD = 120
const RESIZE_TARGET_SIZE = { coarse: 48, fine: 32 }

const captureResizePointer = (event: React.PointerEvent<HTMLDivElement>) => {
  try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Browser keeps document-level dragging as a fallback. */ }
}

function useNarrow() {
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 899px)').matches)
  useEffect(() => {
    const query = matchMedia('(max-width: 899px)')
    const listener = () => setNarrow(query.matches)
    query.addEventListener('change', listener)
    return () => query.removeEventListener('change', listener)
  }, [])
  return narrow
}

export default function App() {
  const { t, i18n } = useTranslation()
  const hydrate = useWorkspace((state) => state.hydrate)
  const hydrated = useWorkspace((state) => state.hydrated)
  const layout = useWorkspace((state) => state.layout)
  const settings = useWorkspace((state) => state.settings)
  const notice = useWorkspace((state) => state.notice)
  const addFile = useWorkspace((state) => state.addFile)
  const setSidebarOpen = useWorkspace((state) => state.setSidebarOpen)
  const setSidebarCollapsed = useWorkspace((state) => state.setSidebarCollapsed)
  const setActiveMobileGroup = useWorkspace((state) => state.setActiveMobileGroup)
  const setSidebarWidth = useWorkspace((state) => state.setSidebarWidth)
  const setSplitRatio = useWorkspace((state) => state.setSplitRatio)
  const setNotice = useWorkspace((state) => state.setNotice)
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const sidebarPanelRef = usePanelRef()
  const restoredSidebarCollapse = useRef(false)
  const sidebarAnimationTimer = useRef<number | null>(null)
  const sidebarDragCleanup = useRef<(() => void) | null>(null)
  const hydrationStarted = useRef(false)
  const narrow = useNarrow()
  const [sidebarAnimating, setSidebarAnimating] = useState(false)
  const [dragTarget, setDragTarget] = useState<'tree' | 'editor' | null>(null)
  const { conflict, applyConflictToAll, setApplyConflictToAll, finishConflict, importItems } = useImportWorkflow()

  useEffect(() => {
    if (hydrationStarted.current) return
    hydrationStarted.current = true
    void hydrate()
  }, [hydrate])
  useEffect(() => {
    if (!hydrated) return
    const importSharedFile = () => {
      if (!hasFileShareMarker()) return
      const href = location.href
      cleanFileShareUrl()
      void readFileShareUrl(href).then((shared) => {
        return importItems([{ kind: 'decoded', ...shared, source: 'drop' }], 'primary')
      }).catch((error) => {
        if (!(error instanceof ShareLinkError)) { setNotice('sharedFileCorrupt'); return }
        const notices = {
          missing: 'sharedFileMissing',
          invalid: 'sharedFileCorrupt',
          tooLarge: 'sharedFileTooLarge',
          unsupportedCompression: 'sharedFileCompressionUnsupported',
          unsupportedImage: 'sharedFileUnsupportedImage',
          unsupportedVersion: 'sharedFileUnsupportedVersion',
          notFound: 'sharedFileNotFound',
          expired: 'sharedFileExpired',
          network: 'sharedFileUnavailable',
          rateLimited: 'sharedFileUnavailable'
        } as const
        setNotice(notices[error.code])
      })
    }
    importSharedFile()
    window.addEventListener('hashchange', importSharedFile)
    window.addEventListener('popstate', importSharedFile)
    return () => {
      window.removeEventListener('hashchange', importSharedFile)
      window.removeEventListener('popstate', importSharedFile)
    }
  }, [hydrated, importItems, setNotice])
  useEffect(() => { void i18n.changeLanguage(settings.locale) }, [i18n, settings.locale])
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
    document.documentElement.lang = settings.locale
  }, [settings])
  useEffect(() => { folderInput.current?.setAttribute('webkitdirectory', '') }, [])
  useEffect(() => {
    if (!hydrated || narrow || restoredSidebarCollapse.current) return
    restoredSidebarCollapse.current = true
    if (layout.sidebarCollapsed) sidebarPanelRef.current?.collapse()
  }, [hydrated, layout.sidebarCollapsed, narrow, sidebarPanelRef])
  useEffect(() => () => {
    sidebarDragCleanup.current?.()
    if (sidebarAnimationTimer.current) window.clearTimeout(sidebarAnimationTimer.current)
  }, [])

  const animateSidebar = useCallback((action: 'collapse' | 'expand') => {
    if (sidebarAnimationTimer.current) window.clearTimeout(sidebarAnimationTimer.current)
    setSidebarAnimating(true)
    requestAnimationFrame(() => {
      sidebarPanelRef.current?.[action]()
      sidebarAnimationTimer.current = window.setTimeout(() => setSidebarAnimating(false), 240)
    })
  }, [sidebarPanelRef])
  const beginSidebarResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || sidebarPanelRef.current?.isCollapsed()) return
    captureResizePointer(event)
    const startX = event.clientX
    const startWidth = sidebarPanelRef.current?.getSize().inPixels ?? layout.sidebarWidth
    let triggered = false
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', cleanup)
      window.removeEventListener('pointercancel', cleanup)
      sidebarDragCleanup.current = null
    }
    const onMove = (moveEvent: PointerEvent) => {
      if (triggered || startWidth + moveEvent.clientX - startX > SIDEBAR_COLLAPSE_THRESHOLD) return
      triggered = true
      animateSidebar('collapse')
      cleanup()
    }
    sidebarDragCleanup.current?.()
    sidebarDragCleanup.current = cleanup
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', cleanup)
    window.addEventListener('pointercancel', cleanup)
  }

  const createQuickDocument = () => addFile('untitled.txt', '')

  const fromInput = (files: FileList | null, target: ImportTarget = false) => {
    if (!files) return
    void importItems(Array.from(files).map((file): ImportItem => ({ kind: 'file', file, path: (file as File & { webkitRelativePath?: string }).webkitRelativePath?.split('/').slice(0, -1).filter(Boolean) })), target)
  }
  const pickFiles = async () => {
    if (window.showOpenFilePicker) {
      try {
        const handles = await window.showOpenFilePicker({ multiple: true })
        await importItems(await Promise.all(handles.map(async (handle): Promise<ImportItem> => ({ kind: 'file', file: await handle.getFile(), handle }))), false)
      } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setNotice('importFailed') }
    } else fileInput.current?.click()
  }
  const pickFolder = async () => {
    if (window.showDirectoryPicker) {
      try {
        const handle = await window.showDirectoryPicker()
        const entries = await collectDirectory(handle)
        await importItems([
          { kind: 'directory', path: [handle.name] },
          ...entries.map((entry) => ({ kind: 'file' as const, ...entry, path: [handle.name, ...entry.path] }))
        ], false)
      } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setNotice('importFailed') }
    } else folderInput.current?.click()
  }
  const handleDrop = (event: React.DragEvent, target: ImportTarget) => {
    if (!event.dataTransfer.items.length && !event.dataTransfer.files.length) return
    event.preventDefault()
    event.stopPropagation()
    setDragTarget(null)
    const items = Array.from(event.dataTransfer.items)
    const files = Array.from(event.dataTransfer.files)
    const containsDirectory = items.some((item) => {
      try {
        return Boolean((item as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory: boolean } | null }).webkitGetAsEntry?.()?.isDirectory)
      } catch { return false }
    })
    const entries = files.length && !containsDirectory
      ? Promise.resolve(files.map((file) => ({ file, path: [] })))
      : collectDroppedItems(items)
    void entries.then((dropped) => importItems(dropped.map((entry) => ({ kind: 'file' as const, ...entry })), target)).catch(() => setNotice('importFailed'))
  }

  if (!hydrated) return <div className="loading"><div className="loading-mark">W</div></div>

  const editorGroups = layout.groups as [EditorGroup, EditorGroup]
  const hasSecondary = Boolean(editorGroups[1].activeFileId)
  return <Tooltip.Provider><WorkspaceDndProvider>
    <div className="app-shell">
      <main className="workbench">
        {!narrow ? <Group orientation="horizontal" id="outer-layout" className={sidebarAnimating ? 'sidebar-animating' : undefined} resizeTargetMinimumSize={RESIZE_TARGET_SIZE}>
          <Panel id="sidebar" panelRef={sidebarPanelRef} defaultSize={`${layout.sidebarWidth}px`} minSize="220px" maxSize="480px" collapsible collapsedSize="0px" onResize={(size) => {
            const collapsed = size.inPixels < 1
            if (collapsed !== layout.sidebarCollapsed) setSidebarCollapsed(collapsed)
            if (!collapsed) setSidebarWidth(size.inPixels)
          }}>
            <div className={`drop-region sidebar-region ${dragTarget === 'tree' ? 'drag-active' : ''}`} onDragEnter={(e) => { if (e.dataTransfer.types.includes('Files')) setDragTarget('tree') }} onDragOver={(e) => e.preventDefault()} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragTarget(null) }} onDrop={(e) => handleDrop(e, false)}>
              <Sidebar onImportFiles={() => void pickFiles()} onImportFolder={() => void pickFolder()} onCollapse={() => animateSidebar('collapse')} />
              {dragTarget === 'tree' && <div className="drop-overlay"><PanelLeft size={26} />{t('dropTree')}</div>}
            </div>
          </Panel>
          <Separator className={`resize-handle sidebar-resize ${layout.sidebarCollapsed ? 'collapsed' : ''}`} onPointerDown={beginSidebarResize} />
          <Panel id="editors" minSize="360px">
            <EditorArea groups={editorGroups} hasSecondary={hasSecondary} splitRatio={layout.splitRatio} setSplitRatio={setSplitRatio} onDrop={handleDrop} dragActive={dragTarget === 'editor'} setDragTarget={setDragTarget} onNewDocument={createQuickDocument} onImportFiles={() => void pickFiles()} leading={layout.sidebarCollapsed ? <IconButton icon={PanelLeftOpen} label={t('showSidebar')} onClick={() => animateSidebar('expand')} /> : undefined} />
          </Panel>
        </Group> : <>
          <div className={`mobile-editor ${dragTarget === 'editor' ? 'drag-active' : ''}`}
            onDragEnter={(event) => { if (event.dataTransfer.types.includes('Files')) setDragTarget('editor') }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragTarget(null) }}
            onDrop={(event) => handleDrop(event, 'active')}>
            <EditorPane group={editorGroups.find((group) => group.id === layout.activeMobileGroup) ?? editorGroups[0]} onNewDocument={createQuickDocument} onImportFiles={() => void pickFiles()} leading={<>
              <IconButton icon={layout.sidebarOpen ? X : Menu} label={t('files')} onClick={() => setSidebarOpen(!layout.sidebarOpen)} />
              {hasSecondary && <div className="group-switch" role="tablist" aria-label={t('editor')}>
                {editorGroups.map((group, index) => <button key={group.id} className={layout.activeMobileGroup === group.id ? 'active' : ''} onClick={() => setActiveMobileGroup(group.id)}>{index + 1}</button>)}
              </div>}
            </>} />
            {dragTarget === 'editor' && <div className="drop-overlay editor-drop"><Upload size={28} />{t('dropEditor')}</div>}
          </div>
          {layout.sidebarOpen && <><button className="drawer-scrim" aria-label={t('close')} onClick={() => setSidebarOpen(false)} /><div className="sidebar-drawer"><Sidebar onImportFiles={() => void pickFiles()} onImportFolder={() => void pickFolder()} /></div></>}
        </>}
      </main>
      {notice && <div className={`toast ${notice === 'copied' || notice === 'shareLinkCopied' ? 'success' : ''}`} role="alert"><span>{t(notice)}</span><button onClick={() => setNotice(null)}><X size={17} /><span className="sr-only">{t('dismiss')}</span></button></div>}
      <Dialog.Root open={Boolean(conflict)} onOpenChange={(open) => { if (!open && conflict) finishConflict('skip') }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <Dialog.Title>{t('collisionTitle')}</Dialog.Title>
            <Dialog.Description>{t('collisionBody', { name: conflict?.name })}</Dialog.Description>
            <label className="dialog-check"><input type="checkbox" checked={applyConflictToAll} onChange={(event) => setApplyConflictToAll(event.target.checked)} />{t('applyAll')}</label>
            <div className="dialog-actions"><button className="secondary-button" onClick={() => finishConflict('skip')}>{t('skip')}</button><button className="secondary-button" onClick={() => finishConflict('copy')}>{t('keepBoth')}</button><button className="primary-button" onClick={() => finishConflict('overwrite')}>{t('overwrite')}</button></div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <input ref={fileInput} type="file" multiple hidden onChange={(event) => { fromInput(event.target.files); event.target.value = '' }} />
      <input ref={folderInput} type="file" multiple hidden onChange={(event) => { fromInput(event.target.files); event.target.value = '' }} />
    </div>
  </WorkspaceDndProvider></Tooltip.Provider>
}

function EditorArea({ groups, hasSecondary, splitRatio, setSplitRatio, onDrop, dragActive, setDragTarget, onNewDocument, onImportFiles, leading }: {
  groups: [EditorGroup, EditorGroup]
  hasSecondary: boolean
  splitRatio: number
  setSplitRatio: (ratio: number) => void
  onDrop: (event: React.DragEvent, target: ImportTarget) => void
  dragActive: boolean
  setDragTarget: (target: 'tree' | 'editor' | null) => void
  onNewDocument: () => void
  onImportFiles: () => void
  leading?: ReactNode
}) {
  const { t } = useTranslation()
  const hasDocument = Boolean(groups[0].activeFileId || groups[1].activeFileId)
  const dropTo = (event: React.DragEvent, target: ImportTarget) => onDrop(event, target)
  return <div className={`editor-area ${dragActive ? 'drag-active' : ''}`} onDragEnter={(event) => { if (event.dataTransfer.types.includes('Files')) setDragTarget('editor') }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragTarget(null) }} onDrop={(event) => dropTo(event, hasDocument ? 'single' : 'active')}>
    {hasSecondary ? <Group orientation="horizontal" id="editor-layout" resizeTargetMinimumSize={RESIZE_TARGET_SIZE} onLayoutChanged={(value, meta) => { if (meta.isUserInteraction) setSplitRatio(value.primary ?? splitRatio) }}>
      <Panel id="primary" defaultSize={splitRatio} minSize="25%"><EditorPane group={groups[0]} leading={leading} onNewDocument={onNewDocument} onImportFiles={onImportFiles} /></Panel>
      <Separator className="resize-handle editor-resize" onPointerDown={captureResizePointer} />
      <Panel id="secondary" defaultSize={100 - splitRatio} minSize="25%"><EditorPane group={groups[1]} onNewDocument={onNewDocument} onImportFiles={onImportFiles} /></Panel>
    </Group> : <EditorPane group={groups[0]} leading={leading} onNewDocument={onNewDocument} onImportFiles={onImportFiles} />}
    {dragActive && (hasDocument ? <div className="external-editor-drop-zones">
      <div className="external-drop-left" onDragEnter={(event) => event.currentTarget.classList.add('active')} onDragLeave={(event) => event.currentTarget.classList.remove('active')} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropTo(event, 'primary')}>{t('openLeft')}</div>
      <div className="external-drop-right" onDragEnter={(event) => event.currentTarget.classList.add('active')} onDragLeave={(event) => event.currentTarget.classList.remove('active')} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropTo(event, 'secondary')}>{t('openRightDrop')}</div>
      <div className="external-drop-single" onDragEnter={(event) => event.currentTarget.classList.add('active')} onDragLeave={(event) => event.currentTarget.classList.remove('active')} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropTo(event, 'single')}><Upload size={22} />{t('dropOpenSingle')}</div>
    </div> : <div className="drop-overlay editor-drop"><Upload size={28} />{t('dropEditor')}</div>)}
    <EditorDropZones />
  </div>
}
