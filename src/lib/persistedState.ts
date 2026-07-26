import type { EditorGroup, FileContent, FileNode, FileRevision, Locale, PersistedState, PersistedSettings, Workspace } from '../types'
import { resolveDocumentViews } from '../documentFormats/registry'
import { dataUrlToBytes } from './files'
import { assertWorkspaceNodes, uniqueSiblingName } from './workspaceInvariant'

export const PERSISTED_STATE_VERSION = 6

type JsonRecord = Record<string, unknown>

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as JsonRecord
}

function string(value: unknown, label: string) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  return value
}

function number(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`)
  return value
}

function boolean(value: unknown, label: string) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
  return value
}

function stringArray(value: unknown, label: string) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) throw new Error(`${label} must be a string array`)
  return value as string[]
}

function optionalString(value: unknown, label: string) {
  if (value === undefined) return undefined
  return string(value, label)
}

function optionalNumber(value: unknown, label: string) {
  if (value === undefined) return undefined
  return number(value, label)
}

function assertNoDuplicates(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicate ids`)
}

function parseWorkspace(value: unknown): Workspace {
  const source = record(value, 'workspace')
  return {
    id: string(source.id, 'workspace.id'),
    name: string(source.name, 'workspace.name'),
    createdAt: number(source.createdAt, 'workspace.createdAt'),
    updatedAt: number(source.updatedAt, 'workspace.updatedAt')
  }
}

function parseNodes(value: unknown, legacy: boolean) {
  const source = record(value, 'nodes')
  const nodes: Record<string, FileNode> = {}
  Object.entries(source).forEach(([id, raw]) => {
    const node = record(raw, `nodes.${id}`)
    const kind = string(node.kind, `nodes.${id}.kind`)
    const parentId = node.parentId === null ? null : string(node.parentId, `nodes.${id}.parentId`)
    if (kind !== 'file' && kind !== 'directory') throw new Error(`nodes.${id}.kind is invalid`)
    if (node.source !== 'new' && node.source !== 'picker' && node.source !== 'drop' && node.source !== 'directory') throw new Error(`nodes.${id}.source is invalid`)
    if (string(node.id, `nodes.${id}.id`) !== id) throw new Error(`Node key does not match id: ${id}`)
    nodes[id] = {
      id,
      parentId,
      name: string(node.name, `nodes.${id}.name`),
      kind,
      order: number(node.order, `nodes.${id}.order`),
      source: node.source,
      ...(optionalString(node.language, `nodes.${id}.language`) !== undefined ? { language: node.language as string } : {}),
      ...(node.handle !== undefined ? { handle: record(node.handle, `nodes.${id}.handle`) as unknown as FileSystemFileHandle } : {})
    }
  })
  const migratedNodes = legacy
    ? Object.values(nodes).sort((a, b) => a.order - b.order).reduce<Record<string, FileNode>>((result, node) => {
        result[node.id] = { ...node, name: uniqueSiblingName(result, node.parentId, node.name) }
        return result
      }, {})
    : nodes
  assertWorkspaceNodes(migratedNodes)
  return migratedNodes
}

function parseContents(value: unknown, nodes: Record<string, FileNode>, legacy: boolean) {
  const source = record(value, 'contents')
  const contents: Record<string, FileContent> = {}
  Object.entries(source).forEach(([id, raw]) => {
    const content = record(raw, `contents.${id}`)
    const status = string(content.status, `contents.${id}.status`)
    if (!['cached', 'saving', 'synced', 'local-only', 'error'].includes(status)) throw new Error(`contents.${id}.status is invalid`)
    if (string(content.fileId, `contents.${id}.fileId`) !== id) throw new Error(`Content key does not match fileId: ${id}`)
    if (nodes[id]?.kind !== 'file') throw new Error(`Content ${id} has no matching file node`)
    const rawKind = legacy && content.contentKind === undefined ? (content.dataUrl === undefined ? 'text' : 'image') : content.contentKind
    if (rawKind !== 'text' && rawKind !== 'binary' && rawKind !== 'image' && rawKind !== 'video') throw new Error(`contents.${id}.contentKind is invalid`)
    const parsedStatus = status === 'saving' ? (nodes[id].handle ? 'cached' : 'local-only') : status as FileContent['status']
    const dataUrl = optionalString(content.dataUrl, `contents.${id}.dataUrl`)
    const migratedData = dataUrl ? dataUrlToBytes(dataUrl) : undefined
    if (content.mediaBlob !== undefined && !(content.mediaBlob instanceof Blob)) throw new Error(`contents.${id}.mediaBlob must be a Blob`)
    const mediaBlob = content.mediaBlob as Blob | undefined ?? (migratedData ? new Blob([migratedData.bytes as BlobPart], { type: migratedData.mimeType }) : undefined)
    const mimeType = optionalString(content.mimeType, `contents.${id}.mimeType`) ?? migratedData?.mimeType
    if (rawKind === 'text' && mediaBlob) throw new Error(`Text content ${id} contains media data`)
    if (rawKind !== 'text' && !mediaBlob) throw new Error(`Media content ${id} has no binary data`)
    if (rawKind === 'binary' && !mimeType) throw new Error(`contents.${id}.mimeType is required for binary content`)
    if ((rawKind === 'image' || rawKind === 'video') && (!mimeType || !mimeType.toLowerCase().startsWith(`${rawKind}/`))) throw new Error(`contents.${id}.mimeType does not match ${rawKind}`)
    const cachedAt = optionalNumber(content.cachedAt, `contents.${id}.cachedAt`)
    const systemModifiedAt = optionalNumber(content.systemModifiedAt, `contents.${id}.systemModifiedAt`)
    const lastError = optionalString(content.lastError, `contents.${id}.lastError`)
    contents[id] = {
      fileId: id,
      text: string(content.text, `contents.${id}.text`),
      version: number(content.version, `contents.${id}.version`),
      status: parsedStatus,
      contentKind: rawKind,
      ...(mediaBlob !== undefined ? { mediaBlob } : {}),
      ...(mimeType !== undefined ? { mimeType } : {}),
      ...(cachedAt !== undefined ? { cachedAt } : {}),
      ...(systemModifiedAt !== undefined ? { systemModifiedAt } : {}),
      ...(lastError !== undefined ? { lastError } : {})
    }
  })
  Object.values(nodes).forEach((node) => {
    if (node.kind === 'file' && !contents[node.id]) throw new Error(`File ${node.id} has no content`)
  })
  return contents
}

function parseRevisions(value: unknown, nodes: Record<string, FileNode>) {
  const source = record(value, 'revisions')
  const revisions: Record<string, FileRevision[]> = {}
  Object.entries(source).forEach(([fileId, raw]) => {
    if (nodes[fileId]?.kind !== 'file') throw new Error(`Revisions ${fileId} have no matching file node`)
    if (!Array.isArray(raw)) throw new Error(`revisions.${fileId} must be an array`)
    revisions[fileId] = raw.map((entry, index) => {
      const revision = record(entry, `revisions.${fileId}.${index}`)
      if (revision.fileId !== fileId) throw new Error(`Revision fileId does not match ${fileId}`)
      return {
        id: string(revision.id, `revisions.${fileId}.${index}.id`),
        fileId,
        text: string(revision.text, `revisions.${fileId}.${index}.text`),
        createdAt: number(revision.createdAt, `revisions.${fileId}.${index}.createdAt`),
        version: number(revision.version, `revisions.${fileId}.${index}.version`)
      }
    })
  })
  return revisions
}

function parseGroup(value: unknown, expectedId: EditorGroup['id'], nodes: Record<string, FileNode>, legacy: boolean): EditorGroup {
  const source = record(value, `layout.groups.${expectedId}`)
  if (source.id !== expectedId) throw new Error(`Editor group id must be ${expectedId}`)
  let tabs = stringArray(source.tabs, `layout.groups.${expectedId}.tabs`)
  assertNoDuplicates(tabs, `layout.groups.${expectedId}.tabs`)
  const activeFileId = source.activeFileId === null ? null : string(source.activeFileId, `layout.groups.${expectedId}.activeFileId`)
  const rawView = string(source.view, `layout.groups.${expectedId}.view`)
  const view = rawView === 'editor' ? 'text-editor' : rawView
  if (!view.trim()) throw new Error(`layout.groups.${expectedId}.view is invalid`)
  tabs.forEach((id) => { if (nodes[id]?.kind !== 'file') throw new Error(`Editor tab references missing file ${id}`) })
  if (activeFileId && nodes[activeFileId]?.kind !== 'file') throw new Error(`Editor group references missing file ${activeFileId}`)
  if (activeFileId && !tabs.includes(activeFileId)) {
    if (!legacy) throw new Error(`Active editor file ${activeFileId} is not in its tabs`)
    tabs = [...tabs, activeFileId]
  }
  return { id: expectedId, tabs, activeFileId, view }
}

function parseSettings(value: unknown): PersistedSettings {
  const source = record(value, 'settings')
  const theme = string(source.theme, 'settings.theme')
  const locale = string(source.locale, 'settings.locale')
  if (theme !== 'system' && theme !== 'light' && theme !== 'dark') throw new Error('settings.theme is invalid')
  if (locale !== 'zh-CN' && locale !== 'en') throw new Error('settings.locale is invalid')
  return { theme, locale: locale as Locale }
}

export function parsePersistedState(value: unknown): PersistedState {
  const source = record(value, 'persisted state')
  const version = source.schemaVersion === undefined ? 0 : number(source.schemaVersion, 'schemaVersion')
  if (version !== 0 && version !== 1 && version !== 2 && version !== 3 && version !== 4 && version !== 5 && version !== PERSISTED_STATE_VERSION) throw new Error(`Unsupported persisted state version: ${version}`)
  const legacy = version < PERSISTED_STATE_VERSION
  const nodes = parseNodes(source.nodes, legacy)
  const contents = parseContents(source.contents, nodes, legacy)
  const layout = record(source.layout, 'layout')
  const rawGroups = layout.groups
  if (!Array.isArray(rawGroups) || rawGroups.length !== 2) throw new Error('layout.groups must contain two groups')
  const rawExpanded = stringArray(source.expanded, 'expanded')
  const expanded = legacy
    ? [...new Set(rawExpanded.filter((id) => nodes[id]?.kind === 'directory'))]
    : rawExpanded
  assertNoDuplicates(expanded, 'expanded')
  expanded.forEach((id) => { if (nodes[id]?.kind !== 'directory') throw new Error(`Expanded list references missing directory ${id}`) })

  const groups = [parseGroup(rawGroups[0], 'primary', nodes, legacy), parseGroup(rawGroups[1], 'secondary', nodes, legacy)] as [EditorGroup, EditorGroup]
  groups.forEach((group, index) => {
    if (!group.activeFileId) return
    const node = nodes[group.activeFileId]
    const content = contents[group.activeFileId]
    const views = resolveDocumentViews({ name: node.name, mimeType: content.mimeType, contentKind: content.contentKind }).views
    if (views.some((view) => view.id === group.view)) return
    if (!legacy) throw new Error(`Editor group ${group.id} uses unsupported view ${group.view}`)
    groups[index] = { ...group, view: views[0].id }
  })
  if (groups[0].activeFileId && groups[0].activeFileId === groups[1].activeFileId && groups[0].view === groups[1].view) {
    if (!legacy) throw new Error(`Both editor groups use view ${groups[0].view} for file ${groups[0].activeFileId}`)
    const fileId = groups[0].activeFileId
    const node = nodes[fileId]
    const content = contents[fileId]
    const alternative = resolveDocumentViews({ name: node.name, mimeType: content.mimeType, contentKind: content.contentKind }).views.find((view) => view.id !== groups[0].view)
    groups[1] = alternative
      ? { ...groups[1], view: alternative.id }
      : { ...groups[1], activeFileId: null, view: 'text-editor' }
  }

  return {
    schemaVersion: PERSISTED_STATE_VERSION,
    workspace: parseWorkspace(source.workspace),
    nodes,
    contents,
    revisions: parseRevisions(legacy && source.revisions === undefined ? {} : source.revisions, nodes),
    expanded,
    layout: {
      sidebarWidth: number(layout.sidebarWidth, 'layout.sidebarWidth'),
      splitRatio: number(layout.splitRatio, 'layout.splitRatio'),
      editorFontSize: legacy && layout.editorFontSize === undefined ? 16 : number(layout.editorFontSize, 'layout.editorFontSize'),
      sidebarOpen: boolean(layout.sidebarOpen, 'layout.sidebarOpen'),
      sidebarCollapsed: legacy && layout.sidebarCollapsed === undefined ? false : boolean(layout.sidebarCollapsed, 'layout.sidebarCollapsed'),
      groups
    },
    settings: parseSettings(source.settings)
  }
}
