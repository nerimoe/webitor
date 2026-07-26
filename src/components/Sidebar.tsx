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
    { id: 'new', priority: 0 }, { id: 'folder', priority: 1 }, { id: 'search', priority: 2 }, { id: 'settings', priority: 3 },
    { id: 'import-files', priority: 4 }, { id: 'import-folder', priority: 5 }, { id: 'export', priority: 6 }, { id: 'share', priority: 7 }
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
  return (
    <aside className="sidebar" data-testid="sidebar"
      onPointerDown={() => { longPress.current = setTimeout(() => undefined, 500) }}
      onPointerUp={() => { if (longPress.current) clearTimeout(longPress.current) }}>
      <div className="sidebar-heading">
        <span>{t('files')}</span>
        <div ref={actionsRef} className="sidebar-actions">
          {visibleIds.has('new') && <IconButton icon={FilePlus2} label={t('newFile')} onClick={createFile} />}
          {visibleIds.has('folder') && <IconButton icon={FolderPlus} label={t('newFolder')} onClick={createFolder} />}
          {visibleIds.has('search') && <IconButton icon={Search} label={t('globalSearch')} onClick={() => setSearchOpen(true)} />}
          {visibleIds.has('settings') && <SettingsMenu />}
          {visibleIds.has('import-files') && <IconButton icon={Upload} label={t('importFiles')} onClick={onImportFiles} />}
          {visibleIds.has('import-folder') && <IconButton icon={FolderInput} label={t('importFolder')} onClick={onImportFolder} />}
          {visibleIds.has('export') && <IconButton icon={Download} label={t('exportWorkspace')} disabled={Object.keys(nodes).length === 0} onClick={() => workspaceZip(nodes, contents, workspace.name)} />}
          {visibleIds.has('share') && <IconButton icon={Share2} label={t('shareWorkspace')} disabled={Object.keys(nodes).length === 0} onClick={() => void shareWorkspace(nodes, contents, workspace.name)} />}
          {overflow.length > 0 && <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild><IconButton icon={MoreHorizontal} label={t('moreActions')} /></DropdownMenu.Trigger>
            <DropdownMenu.Portal><DropdownMenu.Content className="menu-content" align="end">
              {overflow.some((item) => item.id === 'new') && <DropdownMenu.Item className="menu-item with-icon" onSelect={createFile}><FilePlus2 size={18} />{t('newFile')}</DropdownMenu.Item>}
              {overflow.some((item) => item.id === 'folder') && <DropdownMenu.Item className="menu-item with-icon" onSelect={createFolder}><FolderPlus size={18} />{t('newFolder')}</DropdownMenu.Item>}
              {overflow.some((item) => item.id === 'search') && <DropdownMenu.Item className="menu-item with-icon" onSelect={() => setSearchOpen(true)}><Search size={18} />{t('globalSearch')}</DropdownMenu.Item>}
              {overflow.some((item) => item.id === 'settings') && <SettingsMenu asSubmenu />}
              {overflow.some((item) => item.id === 'import-files') && <DropdownMenu.Item className="menu-item with-icon" onSelect={onImportFiles}><Upload size={18} />{t('importFiles')}</DropdownMenu.Item>}
              {overflow.some((item) => item.id === 'import-folder') && <DropdownMenu.Item className="menu-item with-icon" onSelect={onImportFolder}><FolderInput size={18} />{t('importFolder')}</DropdownMenu.Item>}
              {overflow.some((item) => item.id === 'export') && <DropdownMenu.Item className="menu-item with-icon" disabled={Object.keys(nodes).length === 0} onSelect={() => workspaceZip(nodes, contents, workspace.name)}><Download size={18} />{t('exportWorkspace')}</DropdownMenu.Item>}
              {overflow.some((item) => item.id === 'share') && <DropdownMenu.Item className="menu-item with-icon" disabled={Object.keys(nodes).length === 0} onSelect={() => void shareWorkspace(nodes, contents, workspace.name)}><Share2 size={18} />{t('shareWorkspace')}</DropdownMenu.Item>}
            </DropdownMenu.Content></DropdownMenu.Portal>
          </DropdownMenu.Root>}
        </div>
      </div>
      <div className="tree-scroll">{Object.keys(nodes).length ? <FileTree /> : <div className="tree-empty">{t('touchHint')}</div>}</div>
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </aside>
  )
}
