import { useRef, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Download, FilePlus2, FolderInput, FolderPlus, MoreHorizontal, Search, Share2, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { shareWorkspace, workspaceZip } from '../lib/files'
import { useWorkspace } from '../store/useWorkspace'
import { FileTree } from './FileTree'
import { IconButton } from './IconButton'
import { GlobalSearch } from './GlobalSearch'
import { SettingsMenu } from './SettingsMenu'
import { useActionOverflow } from './useActionOverflow'

export function Sidebar({ onImportFiles, onImportFolder }: {
  onImportFiles: () => void
  onImportFolder: () => void
}) {
  const { t } = useTranslation()
  const nodes = useWorkspace((state) => state.nodes)
  const contents = useWorkspace((state) => state.contents)
  const workspace = useWorkspace((state) => state.workspace)
  const addFile = useWorkspace((state) => state.addFile)
  const addDirectory = useWorkspace((state) => state.addDirectory)
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const { ref: actionsRef, visible, overflow } = useActionOverflow([
    { id: 'search', priority: 0 }, { id: 'new', priority: 1 }, { id: 'settings', priority: 2 }
  ], { alwaysOverflow: true })
  const visibleIds = new Set(visible.map((item) => item.id))
  const createFile = () => {
    const name = window.prompt(t('fileName'), 'untitled.txt')
    if (name) addFile(name, '')
  }
  const createFolder = () => {
    const name = window.prompt(t('folderName'), 'folder')
    if (name) addDirectory(name)
  }
  return (
    <aside className="sidebar" data-testid="sidebar"
      onPointerDown={() => { longPress.current = setTimeout(() => undefined, 500) }}
      onPointerUp={() => { if (longPress.current) clearTimeout(longPress.current) }}>
      <div className="sidebar-heading">
        <span>{t('files')}</span>
        <div ref={actionsRef} className="sidebar-actions">
          {visibleIds.has('search') && <IconButton icon={Search} label={t('globalSearch')} onClick={() => setSearchOpen(true)} />}
          {visibleIds.has('new') && <IconButton icon={FilePlus2} label={t('newFile')} onClick={createFile} />}
          {visibleIds.has('settings') && <SettingsMenu />}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild><IconButton icon={MoreHorizontal} label={t('moreActions')} /></DropdownMenu.Trigger>
            <DropdownMenu.Portal><DropdownMenu.Content className="menu-content" align="end">
              {overflow.some((item) => item.id === 'search') && <DropdownMenu.Item className="menu-item with-icon" onSelect={() => setSearchOpen(true)}><Search size={18} />{t('globalSearch')}</DropdownMenu.Item>}
              {overflow.some((item) => item.id === 'new') && <DropdownMenu.Item className="menu-item with-icon" onSelect={createFile}><FilePlus2 size={18} />{t('newFile')}</DropdownMenu.Item>}
              {overflow.some((item) => item.id === 'settings') && <SettingsMenu asSubmenu />}
              {overflow.length > 0 && <DropdownMenu.Separator className="menu-separator" />}
              <DropdownMenu.Item className="menu-item with-icon" onSelect={createFolder}><FolderPlus size={18} />{t('newFolder')}</DropdownMenu.Item>
              <DropdownMenu.Separator className="menu-separator" />
              <DropdownMenu.Item className="menu-item with-icon" onSelect={onImportFiles}><Upload size={16} />{t('importFiles')}</DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item with-icon" onSelect={onImportFolder}><FolderInput size={16} />{t('importFolder')}</DropdownMenu.Item>
              <DropdownMenu.Separator className="menu-separator" />
              <DropdownMenu.Item className="menu-item with-icon" disabled={Object.keys(nodes).length === 0} onSelect={() => workspaceZip(nodes, contents, workspace.name)}><Download size={16} />{t('exportWorkspace')}</DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item with-icon" disabled={Object.keys(nodes).length === 0} onSelect={() => void shareWorkspace(nodes, contents, workspace.name)}><Share2 size={16} />{t('shareWorkspace')}</DropdownMenu.Item>
            </DropdownMenu.Content></DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>
      <div className="tree-scroll">{Object.keys(nodes).length ? <FileTree /> : <div className="tree-empty">{t('touchHint')}</div>}</div>
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </aside>
  )
}
