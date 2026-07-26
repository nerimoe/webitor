import { useCallback, useEffect, useRef, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import * as Dialog from '@radix-ui/react-dialog'
import * as Tooltip from '@radix-ui/react-tooltip'
import { FilePlus2, FolderInput, Menu, PanelLeft, Upload, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { collectDirectory, collectDroppedItems, fileToDataUrl, isProbablyText, isSupportedImage } from './lib/files'
import { useWorkspace } from './store/useWorkspace'
import type { EditorGroup } from './types'
import { EditorPane } from './components/EditorPane'
import { IconButton } from './components/IconButton'
import { Sidebar } from './components/Sidebar'
import { EditorDropZones, WorkspaceDndProvider } from './components/WorkspaceDnd'

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
  const nodes = useWorkspace((state) => state.nodes)
  const layout = useWorkspace((state) => state.layout)
  const settings = useWorkspace((state) => state.settings)
  const notice = useWorkspace((state) => state.notice)
  const addFile = useWorkspace((state) => state.addFile)
  const addDirectory = useWorkspace((state) => state.addDirectory)
  const replaceImportedFile = useWorkspace((state) => state.replaceImportedFile)
  const setSidebarOpen = useWorkspace((state) => state.setSidebarOpen)
  const setActiveMobileGroup = useWorkspace((state) => state.setActiveMobileGroup)
  const setSidebarWidth = useWorkspace((state) => state.setSidebarWidth)
  const setSplitRatio = useWorkspace((state) => state.setSplitRatio)
  const setNotice = useWorkspace((state) => state.setNotice)
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const narrow = useNarrow()
  const [dragTarget, setDragTarget] = useState<'tree' | 'editor' | null>(null)
  const [applyConflictToAll, setApplyConflictToAll] = useState(false)
  const [conflict, setConflict] = useState<null | { name: string; resolve: (result: { choice: 'overwrite' | 'copy' | 'skip'; applyAll: boolean }) => void }>(null)

  useEffect(() => { void hydrate() }, [hydrate])
  useEffect(() => { void i18n.changeLanguage(settings.locale) }, [i18n, settings.locale])
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
    document.documentElement.lang = settings.locale
  }, [settings])
  useEffect(() => { folderInput.current?.setAttribute('webkitdirectory', '') }, [])

  const ensureFolders = useCallback((path: string[], root: string | null = null) => {
    let parentId = root
    for (const name of path) {
      const state = useWorkspace.getState()
      const existing = Object.values(state.nodes).find((node) => node.kind === 'directory' && node.parentId === parentId && node.name === name)
      parentId = existing?.id ?? state.addDirectory(name, parentId)
    }
    return parentId
  }, [])

  const askConflict = useCallback((name: string) => new Promise<{ choice: 'overwrite' | 'copy' | 'skip'; applyAll: boolean }>((resolve) => {
    setApplyConflictToAll(false)
    setConflict({ name, resolve })
  }), [])

  const importEntries = useCallback(async (entries: Array<{ file: File; path?: string[]; handle?: FileSystemFileHandle }>, open: boolean) => {
    let first: string | null = null
    let rejected = false
    let batchChoice: 'overwrite' | 'copy' | 'skip' | null = null
    for (const entry of entries) {
      const image = isSupportedImage(entry.file)
      if (!image && !isProbablyText(entry.file)) { rejected = true; continue }
      try {
        const parentId = ensureFolders(entry.path ?? [])
        const text = image ? '' : await entry.file.text()
        const media = image ? { dataUrl: await fileToDataUrl(entry.file), mimeType: entry.file.type } : undefined
        const existing = Object.values(useWorkspace.getState().nodes).find((node) => node.kind === 'file' && node.parentId === parentId && node.name.toLowerCase() === entry.file.name.toLowerCase())
        let fileId: string
        if (existing) {
          const decision: { choice: 'overwrite' | 'copy' | 'skip'; applyAll: boolean } = batchChoice
            ? { choice: batchChoice, applyAll: true }
            : await askConflict(entry.file.name)
          if (decision.applyAll) batchChoice = decision.choice
          if (decision.choice === 'skip') continue
          if (decision.choice === 'overwrite') {
            replaceImportedFile(existing.id, text, entry.handle, media)
            fileId = existing.id
          } else fileId = addFile(entry.file.name, text, { parentId, source: entry.handle ? 'picker' : 'drop', handle: entry.handle, open: false, ...media })
        } else fileId = addFile(entry.file.name, text, { parentId, source: entry.handle ? 'picker' : 'drop', handle: entry.handle, open: false, ...media })
        first ??= fileId
      } catch { rejected = true }
    }
    if (open && first) useWorkspace.getState().openFile(first, layout.activeMobileGroup)
    if (rejected) setNotice('unsupported')
  }, [addFile, askConflict, ensureFolders, layout.activeMobileGroup, replaceImportedFile, setNotice])

  const finishConflict = (choice: 'overwrite' | 'copy' | 'skip') => {
    conflict?.resolve({ choice, applyAll: applyConflictToAll })
    setConflict(null)
  }

  const createQuickDocument = () => addFile('untitled.txt', '')

  const fromInput = (files: FileList | null, open = false) => {
    if (!files) return
    void importEntries(Array.from(files).map((file) => ({ file, path: (file as File & { webkitRelativePath?: string }).webkitRelativePath?.split('/').slice(0, -1).filter(Boolean) })), open)
  }
  const pickFiles = async () => {
    if (window.showOpenFilePicker) {
      try {
        const handles = await window.showOpenFilePicker({ multiple: true })
        await importEntries(await Promise.all(handles.map(async (handle) => ({ file: await handle.getFile(), handle }))), false)
      } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setNotice('importFailed') }
    } else fileInput.current?.click()
  }
  const pickFolder = async () => {
    if (window.showDirectoryPicker) {
      try {
        const handle = await window.showDirectoryPicker()
        const rootId = ensureFolders([handle.name])
        const entries = await collectDirectory(handle)
        await importEntries(entries.map((entry) => ({ ...entry, path: [handle.name, ...entry.path] })), false)
        void rootId
      } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setNotice('importFailed') }
    } else folderInput.current?.click()
  }
  const handleDrop = (event: React.DragEvent, open: boolean) => {
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
    void entries.then((dropped) => importEntries(dropped, open)).catch(() => setNotice('importFailed'))
  }

  if (!hydrated) return <div className="loading"><div className="loading-mark">W</div></div>

  const editorGroups = layout.groups as [EditorGroup, EditorGroup]
  const hasSecondary = Boolean(editorGroups[1].activeFileId)
  return <Tooltip.Provider><WorkspaceDndProvider>
    <div className="app-shell">
      <main className="workbench">
        {!narrow ? <Group orientation="horizontal" id="outer-layout">
          <Panel id="sidebar" defaultSize={`${layout.sidebarWidth}px`} minSize="220px" maxSize="420px" onResize={(size) => setSidebarWidth(size.inPixels)}>
            <div className={`drop-region sidebar-region ${dragTarget === 'tree' ? 'drag-active' : ''}`} onDragEnter={(e) => { if (e.dataTransfer.types.includes('Files')) setDragTarget('tree') }} onDragOver={(e) => e.preventDefault()} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragTarget(null) }} onDrop={(e) => handleDrop(e, false)}>
              <Sidebar onImportFiles={() => void pickFiles()} onImportFolder={() => void pickFolder()} />
              {dragTarget === 'tree' && <div className="drop-overlay"><PanelLeft size={26} />{t('dropTree')}</div>}
            </div>
          </Panel>
          <Separator className="resize-handle" />
          <Panel id="editors" minSize="360px">
            <EditorArea groups={editorGroups} hasSecondary={hasSecondary} splitRatio={layout.splitRatio} setSplitRatio={setSplitRatio} onDrop={(event) => handleDrop(event, true)} dragActive={dragTarget === 'editor'} setDragTarget={setDragTarget} onNewDocument={createQuickDocument} onImportFiles={() => void pickFiles()} />
          </Panel>
        </Group> : <>
          <div className={`mobile-editor ${dragTarget === 'editor' ? 'drag-active' : ''}`}
            onDragEnter={(event) => { if (event.dataTransfer.types.includes('Files')) setDragTarget('editor') }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragTarget(null) }}
            onDrop={(event) => handleDrop(event, true)}>
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
      {notice && <div className="toast" role="alert"><span>{t(notice)}</span><button onClick={() => setNotice(null)}><X size={17} /><span className="sr-only">{t('dismiss')}</span></button></div>}
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

function EditorArea({ groups, hasSecondary, splitRatio, setSplitRatio, onDrop, dragActive, setDragTarget, onNewDocument, onImportFiles }: {
  groups: [EditorGroup, EditorGroup]
  hasSecondary: boolean
  splitRatio: number
  setSplitRatio: (ratio: number) => void
  onDrop: (event: React.DragEvent) => void
  dragActive: boolean
  setDragTarget: (target: 'tree' | 'editor' | null) => void
  onNewDocument: () => void
  onImportFiles: () => void
}) {
  const { t } = useTranslation()
  return <div className={`editor-area ${dragActive ? 'drag-active' : ''}`} onDragEnter={(event) => { if (event.dataTransfer.types.includes('Files')) setDragTarget('editor') }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragTarget(null) }} onDrop={onDrop}>
    {hasSecondary ? <Group orientation="horizontal" id="editor-layout" onLayoutChanged={(value, meta) => { if (meta.isUserInteraction) setSplitRatio(value.primary ?? splitRatio) }}>
      <Panel id="primary" defaultSize={splitRatio} minSize="25%"><EditorPane group={groups[0]} onNewDocument={onNewDocument} onImportFiles={onImportFiles} /></Panel>
      <Separator className="resize-handle editor-resize" />
      <Panel id="secondary" defaultSize={100 - splitRatio} minSize="25%"><EditorPane group={groups[1]} onNewDocument={onNewDocument} onImportFiles={onImportFiles} /></Panel>
    </Group> : <EditorPane group={groups[0]} onNewDocument={onNewDocument} onImportFiles={onImportFiles} />}
    {dragActive && <div className="drop-overlay editor-drop"><Upload size={28} />{t('dropEditor')}</div>}
    <EditorDropZones />
  </div>
}
