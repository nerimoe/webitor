import { useEffect, useRef, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Download, FilePlus2, FolderInput, FolderPlus, MoreHorizontal, PackageOpen, PanelLeftClose, Search, Share2, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { canShareWorkspace, shareWorkspace, workspaceZip } from '../lib/files'
import { useWorkspace } from '../store/useWorkspace'
import { FileTree } from './FileTree'
import { IconButton } from './IconButton'
import { GlobalSearch } from './GlobalSearch'
import { SettingsMenu } from './SettingsMenu'
import { useActionOverflow } from './useActionOverflow'

const PULL_SEARCH_THRESHOLD = 72

export function Sidebar({ onImportFiles, onImportFolder, onReceivePickup, onCollapse, allowSplit = true }: {
  onImportFiles: () => void
  onImportFolder: () => void
  onReceivePickup: () => void
  onCollapse?: () => void
  allowSplit?: boolean
}) {
  const { t } = useTranslation()
  const nodes = useWorkspace((state) => state.nodes)
  const contents = useWorkspace((state) => state.contents)
  const workspace = useWorkspace((state) => state.workspace)
  const addFile = useWorkspace((state) => state.addFile)
  const addDirectory = useWorkspace((state) => state.addDirectory)
  const shareSupported = canShareWorkspace(workspace.name)
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null)
  const treeScroll = useRef<HTMLDivElement>(null)
  const pullState = useRef<{ startY: number | null; offset: number; wheelTimer: ReturnType<typeof setTimeout> | null }>({ startY: null, offset: 0, wheelTimer: null })
  const [searchOpen, setSearchOpen] = useState(false)
  const [pullOffset, setPullOffset] = useState(0)
  const [pulling, setPulling] = useState(false)
  const { ref: actionsRef, visible, overflow } = useActionOverflow([
    ...(onCollapse ? [{ id: 'collapse', priority: 0 }] : []),
    { id: 'new', priority: 1 }, { id: 'folder', priority: 2 }, { id: 'search', priority: 3 }, { id: 'pickup', priority: 4 }, { id: 'settings', priority: 5 },
    { id: 'import-files', priority: 6 }, { id: 'import-folder', priority: 7 }, { id: 'export', priority: 8 },
    ...(shareSupported ? [{ id: 'share', priority: 9 }] : [])
  ])
  const visibleIds = new Set(visible.map((item) => item.id))
  const createFile = () => {
    const name = window.prompt(t('fileName'), 'untitled.txt')
    if (name) addFile(name, '')
  }
  const createFolder = () => {
    const name = window.prompt(t('folderName'), 'folder')
    if (name) addDirectory(name)
  }
  useEffect(() => {
    const element = treeScroll.current
    if (!element) return
    const setOffset = (offset: number) => {
      pullState.current.offset = offset
      setPullOffset(offset)
    }
    const release = () => {
      const shouldSearch = pullState.current.offset >= PULL_SEARCH_THRESHOLD
      pullState.current.startY = null
      if (pullState.current.wheelTimer) window.clearTimeout(pullState.current.wheelTimer)
      pullState.current.wheelTimer = null
      setPulling(false)
      setOffset(0)
      if (shouldSearch) setSearchOpen(true)
    }
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || element.scrollTop > 0) return
      pullState.current.startY = event.touches[0].clientY
      setPulling(true)
    }
    const onTouchMove = (event: TouchEvent) => {
      const startY = pullState.current.startY
      if (startY === null || event.touches.length !== 1) return
      const distance = event.touches[0].clientY - startY
      if (distance <= 0 || element.scrollTop > 0) return
      event.preventDefault()
      setOffset(Math.min(112, distance * 0.4))
    }
    const onWheel = (event: WheelEvent) => {
      if (element.scrollTop > 0 || event.deltaY >= 0 || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      event.preventDefault()
      setPulling(true)
      setOffset(Math.min(112, pullState.current.offset + Math.abs(event.deltaY) * 0.45))
      if (pullState.current.wheelTimer) window.clearTimeout(pullState.current.wheelTimer)
      pullState.current.wheelTimer = window.setTimeout(release, 140)
    }
    element.addEventListener('touchstart', onTouchStart, { passive: true })
    element.addEventListener('touchmove', onTouchMove, { passive: false })
    element.addEventListener('touchend', release)
    element.addEventListener('touchcancel', release)
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      element.removeEventListener('touchstart', onTouchStart)
      element.removeEventListener('touchmove', onTouchMove)
      element.removeEventListener('touchend', release)
      element.removeEventListener('touchcancel', release)
      element.removeEventListener('wheel', onWheel)
      if (pullState.current.wheelTimer) window.clearTimeout(pullState.current.wheelTimer)
    }
  }, [])
  return (
    <aside className="sidebar" data-testid="sidebar"
      onPointerDown={() => { longPress.current = setTimeout(() => undefined, 500) }}
      onPointerUp={() => { if (longPress.current) clearTimeout(longPress.current) }}>
      <div className="sidebar-heading">
        <span>{t('files')}</span>
        <div ref={actionsRef} className="sidebar-actions">
          {visibleIds.has('collapse') && <IconButton icon={PanelLeftClose} label={t('collapseSidebar')} onClick={onCollapse} />}
          {visibleIds.has('new') && <IconButton icon={FilePlus2} label={t('newFile')} onClick={createFile} />}
          {visibleIds.has('folder') && <IconButton icon={FolderPlus} label={t('newFolder')} onClick={createFolder} />}
          {visibleIds.has('search') && <IconButton icon={Search} label={t('globalSearch')} onClick={() => setSearchOpen(true)} />}
          {visibleIds.has('pickup') && <IconButton icon={PackageOpen} label={t('receivePickupTitle')} onClick={onReceivePickup} />}
          {visibleIds.has('settings') && <SettingsMenu />}
          {visibleIds.has('import-files') && <IconButton icon={Upload} label={t('importFiles')} onClick={onImportFiles} />}
          {visibleIds.has('import-folder') && <IconButton icon={FolderInput} label={t('importFolder')} onClick={onImportFolder} />}
          {visibleIds.has('export') && <IconButton icon={Download} label={t('exportWorkspace')} disabled={Object.keys(nodes).length === 0} onClick={() => workspaceZip(nodes, contents, workspace.name)} />}
          {visibleIds.has('share') && <IconButton icon={Share2} label={t('shareWorkspace')} disabled={Object.keys(nodes).length === 0} onClick={() => void shareWorkspace(nodes, contents, workspace.name)} />}
          {overflow.length > 0 && <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild><IconButton icon={MoreHorizontal} label={t('moreActions')} /></DropdownMenu.Trigger>
            <DropdownMenu.Portal><DropdownMenu.Content className="menu-content" align="end">
              {overflow.some((item) => item.id === 'collapse') && <DropdownMenu.Item className="menu-item with-icon" onSelect={onCollapse}><PanelLeftClose size={18} />{t('collapseSidebar')}</DropdownMenu.Item>}
              {overflow.some((item) => item.id === 'new') && <DropdownMenu.Item className="menu-item with-icon" onSelect={createFile}><FilePlus2 size={18} />{t('newFile')}</DropdownMenu.Item>}
              {overflow.some((item) => item.id === 'folder') && <DropdownMenu.Item className="menu-item with-icon" onSelect={createFolder}><FolderPlus size={18} />{t('newFolder')}</DropdownMenu.Item>}
              {overflow.some((item) => item.id === 'search') && <DropdownMenu.Item className="menu-item with-icon" onSelect={() => setSearchOpen(true)}><Search size={18} />{t('globalSearch')}</DropdownMenu.Item>}
              {overflow.some((item) => item.id === 'pickup') && <DropdownMenu.Item className="menu-item with-icon" onSelect={onReceivePickup}><PackageOpen size={18} />{t('receivePickupTitle')}</DropdownMenu.Item>}
              {overflow.some((item) => item.id === 'settings') && <SettingsMenu asSubmenu />}
              {overflow.some((item) => item.id === 'import-files') && <DropdownMenu.Item className="menu-item with-icon" onSelect={onImportFiles}><Upload size={18} />{t('importFiles')}</DropdownMenu.Item>}
              {overflow.some((item) => item.id === 'import-folder') && <DropdownMenu.Item className="menu-item with-icon" onSelect={onImportFolder}><FolderInput size={18} />{t('importFolder')}</DropdownMenu.Item>}
              {overflow.some((item) => item.id === 'export') && <DropdownMenu.Item className="menu-item with-icon" disabled={Object.keys(nodes).length === 0} onSelect={() => workspaceZip(nodes, contents, workspace.name)}><Download size={18} />{t('exportWorkspace')}</DropdownMenu.Item>}
              {overflow.some((item) => item.id === 'share') && <DropdownMenu.Item className="menu-item with-icon" disabled={Object.keys(nodes).length === 0} onSelect={() => void shareWorkspace(nodes, contents, workspace.name)}><Share2 size={18} />{t('shareWorkspace')}</DropdownMenu.Item>}
            </DropdownMenu.Content></DropdownMenu.Portal>
          </DropdownMenu.Root>}
        </div>
      </div>
      <div ref={treeScroll} className="tree-scroll">
        <div className={`pull-search-indicator ${pullOffset >= PULL_SEARCH_THRESHOLD ? 'ready' : ''}`} style={{ opacity: Math.min(1, pullOffset / 48) }} aria-hidden="true"><Search size={22} /></div>
        <div className={`tree-pull-content ${pulling ? 'pulling' : ''}`} style={{ transform: pullOffset ? `translateY(${pullOffset}px)` : undefined }}>
          {Object.keys(nodes).length ? <FileTree allowSplit={allowSplit} /> : <div className="tree-empty">{t('emptyFileList')}</div>}
        </div>
      </div>
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </aside>
  )
}
