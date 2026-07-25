import { create } from 'zustand'
import { loadState, saveState } from '../lib/db'
import { dataUrlToBlob, downloadBlob, downloadText } from '../lib/files'
import { languageForName } from '../lib/language'
import type { EditorGroup, FileContent, FileNode, FileRevision, Locale, PersistedState, ThemeMode } from '../types'

const id = () => crypto.randomUUID()
const now = () => Date.now()
const locale: Locale = navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'

export const initialPersistedState = (): PersistedState => ({
  workspace: { id: id(), name: 'Documents', createdAt: now(), updatedAt: now() },
  nodes: {},
  contents: {},
  revisions: {},
  expanded: [],
  layout: {
    sidebarWidth: 260,
    splitRatio: 50,
    sidebarOpen: false,
    activeMobileGroup: 'primary',
    groups: [
      { id: 'primary', tabs: [], activeFileId: null, view: 'editor' },
      { id: 'secondary', tabs: [], activeFileId: null, view: 'editor' }
    ]
  },
  settings: { theme: 'system', locale }
})

interface WorkspaceStore extends PersistedState {
  hydrated: boolean
  notice: string | null
  selectedNodeId: string | null
  pendingReveal: { fileId: string; from: number; to: number } | null
  hydrate: () => Promise<void>
  persist: () => Promise<void>
  addFile: (name: string, text: string, options?: { parentId?: string | null; source?: FileNode['source']; handle?: FileSystemFileHandle; open?: boolean; groupId?: EditorGroup['id']; dataUrl?: string; mimeType?: string }) => string
  addDirectory: (name: string, parentId?: string | null) => string
  replaceImportedFile: (fileId: string, text: string, handle?: FileSystemFileHandle, media?: { dataUrl?: string; mimeType?: string }) => void
  renameNode: (nodeId: string, name: string) => void
  deleteNode: (nodeId: string) => void
  moveNode: (nodeId: string, parentId: string | null) => void
  reorderNode: (nodeId: string, parentId: string | null, targetId: string, position: 'before' | 'after') => void
  toggleExpanded: (nodeId: string) => void
  openFile: (fileId: string, groupId?: EditorGroup['id']) => void
  closeTab: (fileId: string, groupId: EditorGroup['id']) => void
  updateContent: (fileId: string, text: string) => void
  saveFile: (fileId: string, forceDialog?: boolean) => Promise<void>
  setGroupView: (groupId: EditorGroup['id'], view: EditorGroup['view']) => void
  previewMarkdown: (fileId: string) => void
  moveTab: (fileId: string, from: EditorGroup['id'], to: EditorGroup['id']) => void
  closeSecondary: () => void
  closePrimary: () => void
  closeGroup: (groupId: EditorGroup['id']) => void
  restoreRevision: (fileId: string, revisionId: string) => void
  setPendingReveal: (reveal: WorkspaceStore['pendingReveal']) => void
  setTheme: (theme: ThemeMode) => void
  setLocale: (locale: Locale) => void
  setSidebarOpen: (open: boolean) => void
  setActiveMobileGroup: (group: EditorGroup['id']) => void
  setSidebarWidth: (width: number) => void
  setSplitRatio: (ratio: number) => void
  setSelectedNodeId: (nodeId: string | null) => void
  setNotice: (notice: string | null) => void
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()
const queues = new Map<string, Promise<void>>()

function snapshot(state: WorkspaceStore): PersistedState {
  return {
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

export const useWorkspace = create<WorkspaceStore>((set, get) => ({
  ...initialPersistedState(),
  hydrated: false,
  notice: null,
  selectedNodeId: null,
  pendingReveal: null,
  hydrate: async () => {
    try {
      const stored = await loadState()
      if (stored) {
        const revisions = { ...(stored.revisions ?? {}) }
        Object.values(stored.contents).forEach((content) => {
          if (content.contentKind !== 'image' && !revisions[content.fileId]?.length) {
            revisions[content.fileId] = [{ id: id(), fileId: content.fileId, text: content.text, createdAt: content.cachedAt ?? stored.workspace.updatedAt, version: content.version }]
          }
        })
        set({ ...stored, revisions, hydrated: true })
      }
      else set({ hydrated: true })
    } catch {
      set({ hydrated: true, notice: 'cacheUnavailable' })
    }
  },
  persist: async () => {
    try {
      await saveState(snapshot(get()))
    } catch (error) {
      set({ notice: error instanceof DOMException && error.name === 'QuotaExceededError' ? 'quotaExceeded' : 'cacheUnavailable' })
      throw error
    }
  },
  addFile: (name, text, options = {}) => {
    const fileId = id()
    const state = get()
    const parentId = options.parentId ?? null
    const siblings = Object.values(state.nodes).filter((node) => node.parentId === parentId)
    let finalName = name
    let counter = 2
    while (siblings.some((node) => node.name.toLowerCase() === finalName.toLowerCase())) {
      const dot = name.lastIndexOf('.')
      finalName = dot > 0 ? `${name.slice(0, dot)} ${counter}${name.slice(dot)}` : `${name} ${counter}`
      counter += 1
    }
    const node: FileNode = {
      id: fileId, parentId, name: finalName, kind: 'file', order: siblings.length,
      language: languageForName(finalName), source: options.source ?? 'new', handle: options.handle
    }
    const content: FileContent = {
      fileId, text, dataUrl: options.dataUrl, mimeType: options.mimeType,
      contentKind: options.dataUrl ? 'image' : 'text', version: 1,
      status: options.handle ? 'cached' : 'local-only'
    }
    const revision: FileRevision | undefined = options.dataUrl ? undefined : { id: id(), fileId, text, createdAt: now(), version: 1 }
    set((current) => ({
      nodes: { ...current.nodes, [fileId]: node },
      contents: { ...current.contents, [fileId]: content },
      revisions: revision ? { ...current.revisions, [fileId]: [revision] } : current.revisions,
      selectedNodeId: fileId,
      workspace: { ...current.workspace, updatedAt: now() }
    }))
    if (options.open !== false) get().openFile(fileId, options.groupId)
    void get().persist()
    return fileId
  },
  addDirectory: (name, parentId = null) => {
    const directoryId = id()
    set((state) => ({
      nodes: { ...state.nodes, [directoryId]: { id: directoryId, parentId, name, kind: 'directory', order: Object.keys(state.nodes).length, source: 'new' } },
      expanded: [...state.expanded, directoryId]
    }))
    void get().persist()
    return directoryId
  },
  replaceImportedFile: (fileId, text, handle, media) => {
    const content = get().contents[fileId]
    const node = get().nodes[fileId]
    if (!content || !node) return
    set((state) => ({
      nodes: { ...state.nodes, [fileId]: { ...node, handle: handle ?? node.handle, source: handle ? 'picker' : node.source } },
      contents: { ...state.contents, [fileId]: { ...content, text, dataUrl: media?.dataUrl, mimeType: media?.mimeType, contentKind: media?.dataUrl ? 'image' : 'text', version: content.version + 1, status: handle ? 'cached' : 'local-only', lastError: undefined } },
      revisions: media?.dataUrl ? state.revisions : { ...state.revisions, [fileId]: [...(state.revisions[fileId] ?? []), { id: id(), fileId, text, createdAt: now(), version: content.version + 1 }].slice(-50) }
    }))
    void get().persist()
  },
  renameNode: (nodeId, name) => {
    const node = get().nodes[nodeId]
    if (!node || !name.trim()) return
    set((state) => ({ nodes: { ...state.nodes, [nodeId]: { ...node, name: name.trim(), language: node.kind === 'file' ? languageForName(name) : undefined } } }))
    void get().persist()
  },
  deleteNode: (nodeId) => {
    const removed = descendants(get().nodes, nodeId)
    set((state) => {
      const nodes = Object.fromEntries(Object.entries(state.nodes).filter(([key]) => !removed.has(key)))
      const contents = Object.fromEntries(Object.entries(state.contents).filter(([key]) => !removed.has(key)))
      const revisions = Object.fromEntries(Object.entries(state.revisions).filter(([key]) => !removed.has(key)))
      const groups = state.layout.groups.map((group) => {
        const tabs = group.tabs.filter((tab) => !removed.has(tab))
        return { ...group, tabs, activeFileId: group.activeFileId && removed.has(group.activeFileId) ? tabs.at(-1) ?? null : group.activeFileId }
      }) as [EditorGroup, EditorGroup]
      return { nodes, contents, revisions, layout: { ...state.layout, groups } }
    })
    void get().persist()
  },
  moveNode: (nodeId, parentId) => {
    const node = get().nodes[nodeId]
    if (!node || nodeId === parentId || (parentId && descendants(get().nodes, nodeId).has(parentId))) return
    set((state) => {
      const targetSiblings = Object.values(state.nodes).filter((entry) => entry.parentId === parentId && entry.id !== nodeId).sort((a, b) => a.order - b.order)
      const oldSiblings = Object.values(state.nodes).filter((entry) => entry.parentId === node.parentId && entry.id !== nodeId).sort((a, b) => a.order - b.order)
      const nodes = { ...state.nodes, [nodeId]: { ...node, parentId, order: targetSiblings.length } }
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
    set((current) => {
      const siblings = Object.values(current.nodes).filter((entry) => entry.parentId === parentId && entry.id !== nodeId).sort((a, b) => a.order - b.order)
      const targetIndex = Math.max(0, siblings.findIndex((entry) => entry.id === targetId))
      siblings.splice(targetIndex + (position === 'after' ? 1 : 0), 0, { ...node, parentId })
      const nodes = { ...current.nodes }
      siblings.forEach((entry, order) => { nodes[entry.id] = { ...entry, order } })
      if (node.parentId !== parentId) {
        Object.values(nodes).filter((entry) => entry.parentId === node.parentId && entry.id !== nodeId).sort((a, b) => a.order - b.order).forEach((entry, order) => { nodes[entry.id] = { ...entry, order } })
      }
      return { nodes }
    })
    void get().persist()
  },
  toggleExpanded: (nodeId) => set((state) => ({ expanded: state.expanded.includes(nodeId) ? state.expanded.filter((id) => id !== nodeId) : [...state.expanded, nodeId] })),
  openFile: (fileId, groupId = 'primary') => {
    set((state) => {
      const closePreview = groupId === 'primary'
        && state.layout.groups[1].view === 'markdown-preview'
        && state.layout.groups[1].activeFileId !== fileId
      const groups = state.layout.groups.map((group) => {
        if (group.id === groupId) return { ...group, tabs: group.tabs.includes(fileId) ? group.tabs : [...group.tabs, fileId], activeFileId: fileId, view: 'editor' as const }
        if (group.id === 'secondary' && closePreview) return { ...group, activeFileId: group.tabs.at(-1) ?? null, view: 'editor' as const }
        return group
      }) as [EditorGroup, EditorGroup]
      return { layout: { ...state.layout, groups, activeMobileGroup: groupId, sidebarOpen: false }, selectedNodeId: fileId }
    })
    void get().persist()
  },
  closeTab: (fileId, groupId) => {
    set((state) => {
      const groups = state.layout.groups.map((group) => {
        if (group.id !== groupId) return group
        const tabs = group.tabs.filter((tab) => tab !== fileId)
        return { ...group, tabs, activeFileId: group.activeFileId === fileId ? tabs.at(-1) ?? null : group.activeFileId }
      }) as [EditorGroup, EditorGroup]
      return { layout: { ...state.layout, groups } }
    })
    void get().persist()
  },
  updateContent: (fileId, text) => {
    const current = get().contents[fileId]
    if (!current || current.text === text) return
    set((state) => ({ contents: { ...state.contents, [fileId]: { ...current, text, version: current.version + 1, status: 'saving', lastError: undefined } } }))
    const oldTimer = timers.get(fileId)
    if (oldTimer) clearTimeout(oldTimer)
    timers.set(fileId, setTimeout(() => {
      const previous = queues.get(fileId) ?? Promise.resolve()
      const job = previous.catch(() => undefined).then(async () => {
        const before = get().contents[fileId]
        await get().persist()
        const node = get().nodes[fileId]
        let status: FileContent['status'] = node?.handle ? 'cached' : 'local-only'
        try {
          if (node?.handle && await node.handle.queryPermission({ mode: 'readwrite' }) === 'granted') {
            const writable = await node.handle.createWritable()
            await writable.write(before.text)
            await writable.close()
            status = 'synced'
          }
          set((state) => ({ contents: { ...state.contents, [fileId]: { ...state.contents[fileId], cachedAt: now(), status } } }))
          set((state) => {
            const revisions = [...(state.revisions[fileId] ?? [])]
            const latest = revisions.at(-1)
            const coalesce = revisions.length > 1 && latest && now() - latest.createdAt < 60_000
            const revision: FileRevision = { id: coalesce ? latest.id : id(), fileId, text: before.text, createdAt: now(), version: before.version }
            if (coalesce) revisions[revisions.length - 1] = revision
            else revisions.push(revision)
            return { revisions: { ...state.revisions, [fileId]: revisions.slice(-50) } }
          })
          await get().persist()
        } catch (error) {
          set((state) => ({ contents: { ...state.contents, [fileId]: { ...state.contents[fileId], status: 'error', lastError: String(error) } } }))
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
      if (handle) {
        const permission = await handle.requestPermission({ mode: 'readwrite' })
        if (permission !== 'granted') handle = undefined
      }
      if (!handle && window.showSaveFilePicker) {
        handle = await window.showSaveFilePicker({ suggestedName: node.name })
        set((state) => ({ nodes: { ...state.nodes, [fileId]: { ...node, handle, source: 'picker' } } }))
      }
      if (handle) {
        const writable = await handle.createWritable()
        await writable.write(content.dataUrl ? dataUrlToBlob(content.dataUrl) : content.text)
        await writable.close()
        set((state) => ({ contents: { ...state.contents, [fileId]: { ...content, status: 'synced', cachedAt: now() } } }))
        await get().persist()
      } else {
        if (content.dataUrl) downloadBlob(dataUrlToBlob(content.dataUrl), node.name)
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
        const leavingPreview = group.view === 'markdown-preview' && view === 'editor' && !group.tabs.includes(group.activeFileId ?? '')
        return { ...group, view, activeFileId: leavingPreview ? group.tabs.at(-1) ?? null : group.activeFileId }
      }) as [EditorGroup, EditorGroup]
    }
  })),
  previewMarkdown: (fileId) => set((state) => {
    const secondary = state.layout.groups[1]
    const closing = secondary.view === 'markdown-preview' && secondary.activeFileId === fileId
    return {
      layout: {
        ...state.layout,
        groups: [state.layout.groups[0], closing
          ? { ...secondary, activeFileId: secondary.tabs.at(-1) ?? null, view: 'editor' }
          : { ...secondary, activeFileId: fileId, view: 'markdown-preview' }],
        activeMobileGroup: !closing && window.matchMedia('(max-width: 899px)').matches ? 'secondary' : state.layout.activeMobileGroup
      }
    }
  }),
  moveTab: (fileId, from, to) => {
    get().closeTab(fileId, from)
    get().openFile(fileId, to)
  },
  closeSecondary: () => set((state) => ({
    layout: {
      ...state.layout,
      activeMobileGroup: 'primary',
      groups: [state.layout.groups[0], { ...state.layout.groups[1], activeFileId: null, view: 'editor' }]
    }
  })),
  closePrimary: () => set((state) => {
    const secondary = state.layout.groups[1]
    if (!secondary.activeFileId) return state
    return {
      layout: {
        ...state.layout,
        activeMobileGroup: 'primary',
        groups: [
          {
            ...secondary,
            id: 'primary',
            tabs: secondary.tabs.includes(secondary.activeFileId)
              ? secondary.tabs
              : [...secondary.tabs, secondary.activeFileId]
          },
          { id: 'secondary', tabs: [], activeFileId: null, view: 'editor' }
        ]
      },
      selectedNodeId: secondary.activeFileId
    }
  }),
  closeGroup: (groupId) => set((state) => {
    const [primary, secondary] = state.layout.groups
    if (groupId === 'primary' && secondary.activeFileId) {
      return {
        layout: {
          ...state.layout,
          activeMobileGroup: 'primary',
          groups: [
            {
              ...secondary,
              id: 'primary',
              tabs: secondary.activeFileId && !secondary.tabs.includes(secondary.activeFileId)
                ? [...secondary.tabs, secondary.activeFileId]
                : secondary.tabs
            },
            { id: 'secondary', tabs: [], activeFileId: null, view: 'editor' }
          ]
        },
        selectedNodeId: secondary.activeFileId
      }
    }
    if (groupId === 'secondary') {
      return { layout: { ...state.layout, activeMobileGroup: 'primary', groups: [primary, { ...secondary, activeFileId: null, view: 'editor' }] } }
    }
    return { layout: { ...state.layout, groups: [{ ...primary, activeFileId: null }, secondary] } }
  }),
  restoreRevision: (fileId, revisionId) => {
    const revision = get().revisions[fileId]?.find((entry) => entry.id === revisionId)
    if (revision) get().updateContent(fileId, revision.text)
  },
  setPendingReveal: (pendingReveal) => set({ pendingReveal }),
  setTheme: (theme) => { set((state) => ({ settings: { ...state.settings, theme } })); void get().persist() },
  setLocale: (nextLocale) => { set((state) => ({ settings: { ...state.settings, locale: nextLocale } })); void get().persist() },
  setSidebarOpen: (sidebarOpen) => set((state) => ({ layout: { ...state.layout, sidebarOpen } })),
  setActiveMobileGroup: (activeMobileGroup) => set((state) => ({ layout: { ...state.layout, activeMobileGroup } })),
  setSidebarWidth: (sidebarWidth) => set((state) => ({ layout: { ...state.layout, sidebarWidth } })),
  setSplitRatio: (splitRatio) => set((state) => ({ layout: { ...state.layout, splitRatio } })),
  setSelectedNodeId: (selectedNodeId) => set({ selectedNodeId }),
  setNotice: (notice) => set({ notice })
}))
