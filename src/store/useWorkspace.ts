import { create } from 'zustand'
import { loadState, saveState, WorkspaceStateLoadError } from '../lib/db'
import { contentMediaBlob, downloadBlob, downloadText } from '../lib/files'
import { languageForName } from '../lib/language'
import { PERSISTED_STATE_VERSION } from '../lib/persistedState'
import { defaultDocumentViewId, resolveDocumentViews } from '../documentFormats/registry'
import { assertDirectoryParent, uniqueSiblingName } from '../lib/workspaceInvariant'
import type { EditorGroup, FileContent, FileNode, FileRevision, Locale, PersistedState, ThemeMode } from '../types'

const id = () => crypto.randomUUID()
const now = () => Date.now()
const locale: Locale = navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'

export const initialPersistedState = (): PersistedState => ({
  schemaVersion: PERSISTED_STATE_VERSION,
  workspace: { id: id(), name: 'Documents', createdAt: now(), updatedAt: now() },
  nodes: {},
  contents: {},
  revisions: {},
  expanded: [],
  layout: {
    sidebarWidth: 260,
    splitRatio: 50,
    editorFontSize: 16,
    sidebarOpen: false,
    sidebarCollapsed: false,
    groups: [
      { id: 'primary', tabs: [], activeFileId: null, view: 'text-editor' },
      { id: 'secondary', tabs: [], activeFileId: null, view: 'text-editor' }
    ]
  },
  settings: { theme: 'system', locale }
})

interface WorkspaceStore extends PersistedState {
  hydrated: boolean
  persistenceBlocked: boolean
  notice: string | null
  selectedNodeId: string | null
  pendingReveal: { fileId: string; from: number; to: number } | null
  hydrate: () => Promise<void>
  persist: () => Promise<boolean>
  addFile: (name: string, text: string, options?: { parentId?: string | null; source?: FileNode['source']; handle?: FileSystemFileHandle; open?: boolean; groupId?: EditorGroup['id']; mediaBlob?: Blob; dataUrl?: string; mimeType?: string; contentKind?: FileContent['contentKind'] }) => string
  addDirectory: (name: string, parentId?: string | null) => string
  replaceImportedFile: (fileId: string, text: string, handle?: FileSystemFileHandle, media?: { mediaBlob?: Blob; dataUrl?: string; mimeType?: string; contentKind?: FileContent['contentKind'] }) => void
  renameNode: (nodeId: string, name: string) => void
  deleteNode: (nodeId: string) => void
  moveNode: (nodeId: string, parentId: string | null) => void
  reorderNode: (nodeId: string, parentId: string | null, targetId: string, position: 'before' | 'after') => void
  toggleExpanded: (nodeId: string) => void
  openFileInGroup: (fileId: string, groupId: EditorGroup['id']) => void
  openFileFullScreen: (fileId: string) => void
  openFileInPane: (fileId: string, groupId: EditorGroup['id']) => void
  openFileView: (fileId: string, groupId: EditorGroup['id'], viewId: string) => void
  closeTab: (fileId: string, groupId: EditorGroup['id']) => void
  updateContent: (fileId: string, text: string) => void
  saveFile: (fileId: string, forceDialog?: boolean) => Promise<void>
  setGroupView: (groupId: EditorGroup['id'], view: EditorGroup['view']) => void
  swapEditorGroups: () => void
  moveTab: (fileId: string, from: EditorGroup['id'], to: EditorGroup['id']) => void
  closeGroup: (groupId: EditorGroup['id']) => void
  restoreRevision: (fileId: string, revisionId: string) => void
  setPendingReveal: (reveal: WorkspaceStore['pendingReveal']) => void
  setTheme: (theme: ThemeMode) => void
  setLocale: (locale: Locale) => void
  setSidebarOpen: (open: boolean) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  setSidebarWidth: (width: number) => void
  setSplitRatio: (ratio: number) => void
  setEditorFontSize: (size: number) => void
  setSelectedNodeId: (nodeId: string | null) => void
  setNotice: (notice: string | null) => void
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()
const queues = new Map<string, Promise<void>>()
const lifecycles = new Map<string, number>()
let hydrationPromise: Promise<void> | null = null
let persistenceQueue: Promise<boolean> = Promise.resolve(true)

function snapshot(state: WorkspaceStore): PersistedState {
  return {
    schemaVersion: PERSISTED_STATE_VERSION,
    workspace: state.workspace,
    nodes: state.nodes,
    contents: state.contents,
    revisions: state.revisions,
    expanded: state.expanded,
    layout: state.layout,
    settings: state.settings
  }
}

function descendants(nodes: Record<string, FileNode>, rootId: string) {
  const result = new Set([rootId])
  let changed = true
  while (changed) {
    changed = false
    Object.values(nodes).forEach((node) => {
      if (node.parentId && result.has(node.parentId) && !result.has(node.id)) {
        result.add(node.id)
        changed = true
      }
    })
  }
  return result
}

function cancelAutosave(fileIds: Iterable<string>) {
  for (const fileId of fileIds) {
    const timer = timers.get(fileId)
    if (timer) clearTimeout(timer)
    timers.delete(fileId)
    lifecycles.set(fileId, (lifecycles.get(fileId) ?? 0) + 1)
  }
}

function persistenceNotice(error: unknown) {
  return error instanceof DOMException && error.name === 'QuotaExceededError' ? 'quotaExceeded' : 'cacheUnavailable'
}

function documentMatch(state: Pick<WorkspaceStore, 'nodes' | 'contents'>, fileId: string) {
  const node = state.nodes[fileId]
  const content = state.contents[fileId]
  if (!node || node.kind !== 'file' || !content) throw new Error(`Cannot resolve a view for missing file ${fileId}`)
  return { name: node.name, mimeType: content.mimeType, contentKind: content.contentKind }
}

function viewForFile(state: Pick<WorkspaceStore, 'nodes' | 'contents'>, fileId: string | null, preferred?: string) {
  if (!fileId) return 'text-editor'
  const input = documentMatch(state, fileId)
  const views = resolveDocumentViews(input).views
  return preferred && views.some((view) => view.id === preferred) ? preferred : defaultDocumentViewId(input)
}

function unoccupiedViewForGroup(state: Pick<WorkspaceStore, 'nodes' | 'contents' | 'layout'>, fileId: string, groupId: EditorGroup['id'], preferred?: string) {
  const views = resolveDocumentViews(documentMatch(state, fileId)).views
  const other = state.layout.groups.find((group) => group.id !== groupId)
  const occupiedView = other?.activeFileId === fileId ? other.view : null
  const available = views.filter((view) => view.id !== occupiedView)
  if (preferred && available.some((view) => view.id === preferred)) return preferred
  return available[0]?.id ?? null
}

export const useWorkspace = create<WorkspaceStore>((set, get) => ({
  ...initialPersistedState(),
  hydrated: false,
  persistenceBlocked: false,
  notice: null,
  selectedNodeId: null,
  pendingReveal: null,
  hydrate: () => {
    const current = get()
    if (current.hydrated && (!current.persistenceBlocked || Object.keys(current.nodes).length > 0)) return Promise.resolve()
    if (hydrationPromise) return hydrationPromise
    hydrationPromise = (async () => {
      try {
        const stored = await loadState()
        if (stored) {
          const revisions = { ...stored.revisions }
          Object.values(stored.contents).forEach((content) => {
            if (content.contentKind === 'text' && !revisions[content.fileId]?.length) {
              revisions[content.fileId] = [{ id: id(), fileId: content.fileId, text: content.text, createdAt: content.cachedAt ?? stored.workspace.updatedAt, version: content.version }]
            }
          })
          const groups = stored.layout.groups.map((group) => ({ ...group, view: viewForFile(stored, group.activeFileId, group.view) })) as [EditorGroup, EditorGroup]
          set({ ...stored, revisions, layout: { ...stored.layout, groups }, hydrated: true, persistenceBlocked: false, notice: null })
        }
        else set({ hydrated: true, persistenceBlocked: false, notice: null })
      } catch (error) {
        const cause = error instanceof WorkspaceStateLoadError ? error.cause : error
        console.error('Workspace hydration failed:', cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause))
        set({ hydrated: true, persistenceBlocked: true, notice: error instanceof WorkspaceStateLoadError ? 'workspaceRestoreFailed' : 'cacheUnavailable' })
      } finally {
        hydrationPromise = null
      }
    })()
    return hydrationPromise
  },
  persist: async () => {
    if (get().persistenceBlocked) return false
    const job = persistenceQueue.then(async () => {
      if (get().persistenceBlocked) return false
      try {
        await saveState(snapshot(get()))
        return true
      } catch (error) {
        set({ notice: persistenceNotice(error) })
        return false
      }
    })
    persistenceQueue = job
    return job
  },
  addFile: (name, text, options = {}) => {
    const fileId = id()
    const state = get()
    const parentId = options.parentId ?? null
    assertDirectoryParent(state.nodes, parentId)
    const siblings = Object.values(state.nodes).filter((node) => node.parentId === parentId)
    const finalName = uniqueSiblingName(state.nodes, parentId, name)
    const node: FileNode = {
      id: fileId, parentId, name: finalName, kind: 'file', order: siblings.length,
      language: languageForName(finalName), source: options.source ?? 'new', handle: options.handle
    }
    const content: FileContent = {
      fileId, text, mediaBlob: options.mediaBlob, dataUrl: options.dataUrl, mimeType: options.mimeType,
      contentKind: options.contentKind ?? (options.mediaBlob || options.dataUrl ? 'image' : 'text'), version: 1,
      status: options.handle ? 'cached' : 'local-only'
    }
    const revision: FileRevision | undefined = content.contentKind === 'text' ? { id: id(), fileId, text, createdAt: now(), version: 1 } : undefined
    set((current) => ({
      nodes: { ...current.nodes, [fileId]: node },
      contents: { ...current.contents, [fileId]: content },
      revisions: revision ? { ...current.revisions, [fileId]: [revision] } : current.revisions,
      selectedNodeId: fileId,
      workspace: { ...current.workspace, updatedAt: now() }
    }))
    if (options.open !== false) {
      if (options.groupId) get().openFileInGroup(fileId, options.groupId)
      else get().openFileFullScreen(fileId)
    }
    void get().persist()
    return fileId
  },
  addDirectory: (name, parentId = null) => {
    const directoryId = id()
    assertDirectoryParent(get().nodes, parentId)
    set((state) => ({
      nodes: { ...state.nodes, [directoryId]: { id: directoryId, parentId, name: uniqueSiblingName(state.nodes, parentId, name), kind: 'directory', order: Object.values(state.nodes).filter((node) => node.parentId === parentId).length, source: 'new' } },
      expanded: [...state.expanded, directoryId]
    }))
    void get().persist()
    return directoryId
  },
  replaceImportedFile: (fileId, text, handle, media) => {
    const content = get().contents[fileId]
    const node = get().nodes[fileId]
    if (!content || !node || node.kind !== 'file') throw new Error(`Cannot replace missing file ${fileId}`)
    const nextKind = media?.contentKind ?? (media?.mediaBlob || media?.dataUrl ? 'image' : 'text')
    set((state) => ({
      nodes: { ...state.nodes, [fileId]: { ...node, handle: handle ?? node.handle, source: handle ? 'picker' : node.source } },
      contents: { ...state.contents, [fileId]: { ...content, text, mediaBlob: media?.mediaBlob, dataUrl: media?.dataUrl, mimeType: media?.mimeType, contentKind: nextKind, version: content.version + 1, status: handle ? 'cached' : 'local-only', lastError: undefined } },
      revisions: nextKind === 'text' ? { ...state.revisions, [fileId]: [...(state.revisions[fileId] ?? []), { id: id(), fileId, text, createdAt: now(), version: content.version + 1 }].slice(-50) } : state.revisions
    }))
    void get().persist()
  },
  renameNode: (nodeId, name) => {
    const node = get().nodes[nodeId]
    if (!node || !name.trim()) return
    const finalName = uniqueSiblingName(get().nodes, node.parentId, name.trim(), nodeId)
    set((state) => ({ nodes: { ...state.nodes, [nodeId]: { ...node, name: finalName, language: node.kind === 'file' ? languageForName(finalName) : undefined } } }))
    void get().persist()
  },
  deleteNode: (nodeId) => {
    const removed = descendants(get().nodes, nodeId)
    cancelAutosave([...removed].filter((id) => get().nodes[id]?.kind === 'file'))
    set((state) => {
      const nodes = Object.fromEntries(Object.entries(state.nodes).filter(([key]) => !removed.has(key)))
      const contents = Object.fromEntries(Object.entries(state.contents).filter(([key]) => !removed.has(key)))
      const revisions = Object.fromEntries(Object.entries(state.revisions).filter(([key]) => !removed.has(key)))
      const groups = state.layout.groups.map((group) => {
        const tabs = group.tabs.filter((tab) => !removed.has(tab))
        const activeFileId = group.activeFileId && removed.has(group.activeFileId) ? tabs.at(-1) ?? null : group.activeFileId
        return { ...group, tabs, activeFileId, view: viewForFile({ nodes, contents }, activeFileId, activeFileId === group.activeFileId ? group.view : undefined) }
      }) as [EditorGroup, EditorGroup]
      return {
        nodes,
        contents,
        revisions,
        expanded: state.expanded.filter((id) => !removed.has(id)),
        layout: { ...state.layout, groups },
        selectedNodeId: state.selectedNodeId && removed.has(state.selectedNodeId) ? null : state.selectedNodeId,
        pendingReveal: state.pendingReveal && removed.has(state.pendingReveal.fileId) ? null : state.pendingReveal
      }
    })
    void get().persist()
  },
  moveNode: (nodeId, parentId) => {
    const node = get().nodes[nodeId]
    if (!node || nodeId === parentId || (parentId && descendants(get().nodes, nodeId).has(parentId))) return
    assertDirectoryParent(get().nodes, parentId)
    set((state) => {
      const targetSiblings = Object.values(state.nodes).filter((entry) => entry.parentId === parentId && entry.id !== nodeId).sort((a, b) => a.order - b.order)
      const oldSiblings = Object.values(state.nodes).filter((entry) => entry.parentId === node.parentId && entry.id !== nodeId).sort((a, b) => a.order - b.order)
      const name = uniqueSiblingName(state.nodes, parentId, node.name, nodeId)
      const nodes = { ...state.nodes, [nodeId]: { ...node, name, parentId, order: targetSiblings.length } }
      oldSiblings.forEach((entry, order) => { nodes[entry.id] = { ...nodes[entry.id], order } })
      return { nodes, expanded: parentId ? [...new Set([...state.expanded, parentId])] : state.expanded }
    })
    void get().persist()
  },
  reorderNode: (nodeId, parentId, targetId, position) => {
    const state = get()
    const node = state.nodes[nodeId]
    const target = state.nodes[targetId]
    if (!node || !target || nodeId === targetId || nodeId === parentId || (parentId && descendants(state.nodes, nodeId).has(parentId))) return
    if (target.parentId !== parentId) throw new Error(`Reorder target ${targetId} is not in the requested parent`)
    assertDirectoryParent(state.nodes, parentId)
    set((current) => {
      const siblings = Object.values(current.nodes).filter((entry) => entry.parentId === parentId && entry.id !== nodeId).sort((a, b) => a.order - b.order)
      const targetIndex = Math.max(0, siblings.findIndex((entry) => entry.id === targetId))
      const name = uniqueSiblingName(current.nodes, parentId, node.name, nodeId)
      siblings.splice(targetIndex + (position === 'after' ? 1 : 0), 0, { ...node, name, parentId })
      const nodes = { ...current.nodes }
      siblings.forEach((entry, order) => { nodes[entry.id] = { ...entry, order } })
      if (node.parentId !== parentId) {
        Object.values(nodes).filter((entry) => entry.parentId === node.parentId && entry.id !== nodeId).sort((a, b) => a.order - b.order).forEach((entry, order) => { nodes[entry.id] = { ...entry, order } })
      }
      return { nodes }
    })
    void get().persist()
  },
  toggleExpanded: (nodeId) => {
    if (get().nodes[nodeId]?.kind !== 'directory') throw new Error(`Cannot expand missing directory ${nodeId}`)
    set((state) => ({ expanded: state.expanded.includes(nodeId) ? state.expanded.filter((id) => id !== nodeId) : [...state.expanded, nodeId] }))
  },
  openFileInGroup: (fileId, groupId) => {
    if (get().nodes[fileId]?.kind !== 'file') throw new Error(`Cannot open missing file ${fileId}`)
    const view = unoccupiedViewForGroup(get(), fileId, groupId)
    if (view) get().openFileView(fileId, groupId, view)
  },
  openFileFullScreen: (fileId) => {
    const state = get()
    if (state.nodes[fileId]?.kind !== 'file') throw new Error(`Cannot open missing file ${fileId}`)
    const view = defaultDocumentViewId(documentMatch(state, fileId))
    set((current) => {
      const [primary, secondary] = current.layout.groups
      return {
        layout: {
          ...current.layout,
          sidebarOpen: false,
          groups: [
            { ...primary, tabs: primary.tabs.includes(fileId) ? primary.tabs : [...primary.tabs, fileId], activeFileId: fileId, view },
            { ...secondary, activeFileId: null, view: 'text-editor' }
          ]
        },
        selectedNodeId: fileId
      }
    })
    void get().persist()
  },
  openFileInPane: (fileId, groupId) => {
    const state = get()
    if (state.nodes[fileId]?.kind !== 'file') throw new Error(`Cannot open missing file ${fileId}`)
    const target = state.layout.groups.find((group) => group.id === groupId)
    if (!target) throw new Error(`Cannot drop into missing editor group ${groupId}`)
    const other = state.layout.groups.find((group) => group.id !== groupId)
    if (!other) throw new Error(`Cannot find the editor group opposite ${groupId}`)
    if (target.activeFileId !== fileId) {
      const view = unoccupiedViewForGroup(state, fileId, groupId)
      if (!view) return
      set((current) => {
        const groups = current.layout.groups.map((group) => {
          if (group.id === groupId) return {
            ...group,
            tabs: group.tabs.includes(fileId) ? group.tabs : [...group.tabs, fileId],
            activeFileId: fileId,
            view
          }
          if (group.id === other.id && groupId === 'primary' && !other.activeFileId && target.activeFileId) return {
            ...group,
            tabs: group.tabs.includes(target.activeFileId) ? group.tabs : [...group.tabs, target.activeFileId],
            activeFileId: target.activeFileId,
            view: target.view
          }
          return group
        }) as [EditorGroup, EditorGroup]
        return {
          layout: { ...current.layout, groups, sidebarOpen: false },
          selectedNodeId: fileId
        }
      })
      void get().persist()
      return
    }

    const views = resolveDocumentViews(documentMatch(state, fileId)).views
    if (views.length < 2) return
    const currentIndex = views.findIndex((view) => view.id === target.view)
    if (currentIndex < 0) throw new Error(`View ${target.view} does not support file ${fileId}`)
    const nextView = views[(currentIndex + 1) % views.length]
    const displacedView = target.view

    set((current) => {
      const groups = current.layout.groups.map((group) => {
        if (group.id === groupId) return { ...group, view: nextView.id }
        if (group.id === other.id) return {
          ...group,
          tabs: group.tabs.includes(fileId) ? group.tabs : [...group.tabs, fileId],
          activeFileId: fileId,
          view: displacedView
        }
        throw new Error(`Unexpected editor group ${group.id}`)
      }) as [EditorGroup, EditorGroup]
      return {
        layout: { ...current.layout, groups, sidebarOpen: false },
        selectedNodeId: fileId
      }
    })
    void get().persist()
  },
  openFileView: (fileId, groupId, viewId) => {
    if (get().nodes[fileId]?.kind !== 'file') throw new Error(`Cannot open missing file ${fileId}`)
    const available = resolveDocumentViews(documentMatch(get(), fileId)).views
    if (!available.some((view) => view.id === viewId)) throw new Error(`View ${viewId} does not support file ${fileId}`)
    const other = get().layout.groups.find((group) => group.id !== groupId)
    if (other?.activeFileId === fileId && other.view === viewId) throw new Error(`View ${viewId} is already open for file ${fileId}`)
    set((state) => {
      const groups = state.layout.groups.map((group) => {
        if (group.id === groupId) return { ...group, tabs: group.tabs.includes(fileId) ? group.tabs : [...group.tabs, fileId], activeFileId: fileId, view: viewId }
        return group
      }) as [EditorGroup, EditorGroup]
      return { layout: { ...state.layout, groups, sidebarOpen: false }, selectedNodeId: fileId }
    })
    void get().persist()
  },
  closeTab: (fileId, groupId) => {
    set((state) => {
      const groups = state.layout.groups.map((group) => {
        if (group.id !== groupId) return group
        const tabs = group.tabs.filter((tab) => tab !== fileId)
        const activeFileId = group.activeFileId === fileId ? tabs.at(-1) ?? null : group.activeFileId
        return { ...group, tabs, activeFileId, view: viewForFile(state, activeFileId, activeFileId === group.activeFileId ? group.view : undefined) }
      }) as [EditorGroup, EditorGroup]
      return { layout: { ...state.layout, groups } }
    })
    void get().persist()
  },
  updateContent: (fileId, text) => {
    const current = get().contents[fileId]
    if (!current) throw new Error(`Cannot edit missing file ${fileId}`)
    if (current.text === text) return
    set((state) => ({ contents: { ...state.contents, [fileId]: { ...current, text, version: current.version + 1, status: 'saving', lastError: undefined } } }))
    const oldTimer = timers.get(fileId)
    if (oldTimer) clearTimeout(oldTimer)
    const lifecycle = lifecycles.get(fileId) ?? 0
    timers.set(fileId, setTimeout(() => {
      timers.delete(fileId)
      const previous = queues.get(fileId) ?? Promise.resolve()
      const job = previous.then(async () => {
        if ((lifecycles.get(fileId) ?? 0) !== lifecycle) return
        const before = get().contents[fileId]
        if (!before) throw new Error(`Autosave invariant failed for ${fileId}`)
        const cached = await get().persist()
        if ((lifecycles.get(fileId) ?? 0) !== lifecycle) return
        if (!cached) {
          set((state) => {
            const content = state.contents[fileId]
            if (!content || content.version !== before.version) return state
            return { contents: { ...state.contents, [fileId]: { ...content, status: 'error', lastError: 'Browser storage write failed' } } }
          })
          return
        }
        const node = get().nodes[fileId]
        if (!node || node.kind !== 'file') throw new Error(`Autosave node invariant failed for ${fileId}`)
        let status: FileContent['status'] = node.handle ? 'cached' : 'local-only'
        try {
          if (node.handle && await node.handle.queryPermission({ mode: 'readwrite' }) === 'granted') {
            const writable = await node.handle.createWritable()
            await writable.write(before.text)
            await writable.close()
            status = 'synced'
          }
        } catch (error) {
          if ((lifecycles.get(fileId) ?? 0) !== lifecycle) return
          set((state) => {
            const content = state.contents[fileId]
            if (!content || content.version !== before.version) return state
            return { contents: { ...state.contents, [fileId]: { ...content, status: 'error', lastError: String(error) } } }
          })
          return
        }
        if ((lifecycles.get(fileId) ?? 0) !== lifecycle) return
        set((state) => {
          const content = state.contents[fileId]
          if (!content || content.version !== before.version) return state
          return { contents: { ...state.contents, [fileId]: { ...content, cachedAt: now(), status } } }
        })
        set((state) => {
          if (!state.contents[fileId]) return state
          const revisions = [...(state.revisions[fileId] ?? [])]
          const latest = revisions.at(-1)
          const coalesce = revisions.length > 1 && latest && now() - latest.createdAt < 60_000
          const revision: FileRevision = { id: coalesce ? latest.id : id(), fileId, text: before.text, createdAt: now(), version: before.version }
          if (coalesce) revisions[revisions.length - 1] = revision
          else revisions.push(revision)
          return { revisions: { ...state.revisions, [fileId]: revisions.slice(-50) } }
        })
        const completed = await get().persist()
        if (!completed && (lifecycles.get(fileId) ?? 0) === lifecycle) {
          set((state) => {
            const content = state.contents[fileId]
            if (!content || content.version !== before.version) return state
            return { contents: { ...state.contents, [fileId]: { ...content, status: 'error', lastError: 'Browser storage write failed' } } }
          })
        }
      })
      queues.set(fileId, job)
    }, 1000))
  },
  saveFile: async (fileId, forceDialog = false) => {
    const node = get().nodes[fileId]
    const content = get().contents[fileId]
    if (!node || !content) return
    try {
      let handle = forceDialog ? undefined : node.handle
      if (!forceDialog && handle) {
        const permission = await handle.requestPermission({ mode: 'readwrite' })
        if (permission !== 'granted') throw new Error('Write permission was not granted')
      }
      if (forceDialog && window.showSaveFilePicker) {
        handle = await window.showSaveFilePicker({ suggestedName: node.name })
        set((state) => ({ nodes: { ...state.nodes, [fileId]: { ...node, handle, source: 'picker' } } }))
      }
      if (handle) {
        const writable = await handle.createWritable()
        await writable.write(content.contentKind !== 'text' ? contentMediaBlob(content) : content.text)
        await writable.close()
        set((state) => ({ contents: { ...state.contents, [fileId]: { ...content, status: 'synced', cachedAt: now() } } }))
        if (!await get().persist()) return
      } else {
        if (content.contentKind !== 'text') downloadBlob(contentMediaBlob(content), node.name)
        else downloadText(content.text, node.name)
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      set((state) => ({ contents: { ...state.contents, [fileId]: { ...content, status: 'error', lastError: String(error) } }, notice: 'saveFailed' }))
    }
  },
  setGroupView: (groupId, view) => set((state) => ({
    layout: {
      ...state.layout,
      groups: state.layout.groups.map((group) => {
        if (group.id !== groupId) return group
        if (!group.activeFileId) throw new Error(`Cannot set a view on empty group ${groupId}`)
        const views = resolveDocumentViews(documentMatch(state, group.activeFileId)).views
        if (!views.some((candidate) => candidate.id === view)) throw new Error(`View ${view} does not support file ${group.activeFileId}`)
        const other = state.layout.groups.find((candidate) => candidate.id !== groupId)
        if (other?.activeFileId === group.activeFileId && other.view === view) throw new Error(`View ${view} is already open for file ${group.activeFileId}`)
        return { ...group, view }
      }) as [EditorGroup, EditorGroup]
    }
  })),
  swapEditorGroups: () => {
    set((state) => {
      const [primary, secondary] = state.layout.groups
      if (!secondary.activeFileId) return state
      return {
        layout: {
          ...state.layout,
          groups: [
            { ...secondary, id: 'primary' },
            { ...primary, id: 'secondary' }
          ]
        }
      }
    })
    void get().persist()
  },
  moveTab: (fileId, from, to) => {
    get().closeTab(fileId, from)
    get().openFileInGroup(fileId, to)
  },
  closeGroup: (groupId) => {
    set((state) => {
      const [primary, secondary] = state.layout.groups
      if (groupId === 'primary' && secondary.activeFileId) {
        return {
          layout: {
            ...state.layout,
            groups: [
              {
                ...secondary,
                id: 'primary',
                tabs: !secondary.tabs.includes(secondary.activeFileId)
                  ? [...secondary.tabs, secondary.activeFileId]
                  : secondary.tabs
              },
              { id: 'secondary', tabs: [], activeFileId: null, view: 'text-editor' }
            ]
          },
          selectedNodeId: secondary.activeFileId
        }
      }
      if (groupId === 'secondary') {
        return {
          layout: { ...state.layout, groups: [primary, { ...secondary, activeFileId: null, view: 'text-editor' }] },
          selectedNodeId: primary.activeFileId
        }
      }
      return {
        layout: { ...state.layout, groups: [{ ...primary, activeFileId: null, view: 'text-editor' }, secondary] },
        selectedNodeId: null
      }
    })
    void get().persist()
  },
  restoreRevision: (fileId, revisionId) => {
    const revision = get().revisions[fileId]?.find((entry) => entry.id === revisionId)
    if (revision) get().updateContent(fileId, revision.text)
  },
  setPendingReveal: (pendingReveal) => set({ pendingReveal }),
  setTheme: (theme) => { set((state) => ({ settings: { ...state.settings, theme } })); void get().persist() },
  setLocale: (nextLocale) => { set((state) => ({ settings: { ...state.settings, locale: nextLocale } })); void get().persist() },
  setSidebarOpen: (sidebarOpen) => set((state) => ({ layout: { ...state.layout, sidebarOpen } })),
  setSidebarCollapsed: (sidebarCollapsed) => {
    set((state) => ({ layout: { ...state.layout, sidebarCollapsed } }))
    void get().persist()
  },
  setSidebarWidth: (sidebarWidth) => set((state) => ({ layout: { ...state.layout, sidebarWidth } })),
  setSplitRatio: (splitRatio) => set((state) => ({ layout: { ...state.layout, splitRatio } })),
  setEditorFontSize: (editorFontSize) => {
    set((state) => ({ layout: { ...state.layout, editorFontSize: Math.max(12, Math.min(28, editorFontSize)) } }))
    void get().persist()
  },
  setSelectedNodeId: (selectedNodeId) => set({ selectedNodeId }),
  setNotice: (notice) => set({ notice })
}))
