export type NodeKind = 'file' | 'directory'
export type SyncStatus = 'cached' | 'saving' | 'synced' | 'local-only' | 'error'
export type ThemeMode = 'system' | 'light' | 'dark'
export type Locale = 'zh-CN' | 'en'

export interface Workspace {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

export interface FileNode {
  id: string
  parentId: string | null
  name: string
  kind: NodeKind
  order: number
  language?: string
  source: 'new' | 'picker' | 'drop' | 'directory'
  handle?: FileSystemFileHandle
}

export interface FileContent {
  fileId: string
  text: string
  contentKind?: 'text' | 'image'
  dataUrl?: string
  mimeType?: string
  version: number
  cachedAt?: number
  systemModifiedAt?: number
  status: SyncStatus
  lastError?: string
}

export interface FileRevision {
  id: string
  fileId: string
  text: string
  createdAt: number
  version: number
}

export interface EditorGroup {
  id: 'primary' | 'secondary'
  tabs: string[]
  activeFileId: string | null
  view: 'editor' | 'markdown-preview'
}

export interface PersistedLayout {
  sidebarWidth: number
  splitRatio: number
  editorFontSize: number
  sidebarOpen: boolean
  sidebarCollapsed: boolean
  activeMobileGroup: 'primary' | 'secondary'
  groups: [EditorGroup, EditorGroup]
}

export interface PersistedSettings {
  theme: ThemeMode
  locale: Locale
}

export interface PersistedState {
  workspace: Workspace
  nodes: Record<string, FileNode>
  contents: Record<string, FileContent>
  revisions: Record<string, FileRevision[]>
  expanded: string[]
  layout: PersistedLayout
  settings: PersistedSettings
}

declare global {
  interface FileSystemWritableFileStream {
    write(data: string | Blob | BufferSource): Promise<void>
    close(): Promise<void>
  }

  interface FileSystemFileHandle {
    readonly kind: 'file'
    name: string
    getFile(): Promise<File>
    createWritable(): Promise<FileSystemWritableFileStream>
    queryPermission(descriptor?: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
    requestPermission(descriptor?: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  }

  interface FileSystemDirectoryHandle {
    readonly kind: 'directory'
    name: string
    values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>
  }

  interface Window {
    showOpenFilePicker?: (options?: Record<string, unknown>) => Promise<FileSystemFileHandle[]>
    showDirectoryPicker?: (options?: Record<string, unknown>) => Promise<FileSystemDirectoryHandle>
    showSaveFilePicker?: (options?: Record<string, unknown>) => Promise<FileSystemFileHandle>
  }
}
