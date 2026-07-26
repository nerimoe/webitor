import { zipSync, strToU8 } from 'fflate'
import type { FileNode } from '../types'

export function isProbablyText(file: File) {
  if (file.type.startsWith('text/')) return true
  if (mediaKindForFile(file)) return false
  const blocked = /\.(pdf|zip|gz|7z|rar|woff2?|ttf|otf|wasm|exe|dmg)$/i
  return !blocked.test(file.name)
}

export type MediaKind = 'image' | 'video'

export function mediaKindForFile(file: Pick<File, 'name' | 'type'>): MediaKind | null {
  if (file.type.toLowerCase().startsWith('image/')) return 'image'
  if (file.type.toLowerCase().startsWith('video/')) return 'video'
  if (/\.(avif|bmp|gif|heic|heif|ico|jfif|jpe?g|png|svg|tif{1,2}|webp)$/i.test(file.name)) return 'image'
  if (/\.(3g2|3gp|avi|flv|m4v|mkv|mov|mp4|mpeg|mpg|ogv|ts|webm|wmv)$/i.test(file.name)) return 'video'
  return null
}

export function mediaMimeType(file: Pick<File, 'name' | 'type'>, kind: MediaKind) {
  if (file.type.toLowerCase().startsWith(`${kind}/`)) return file.type
  const extension = file.name.split('.').at(-1)?.toLowerCase() ?? ''
  const known: Record<string, string> = {
    avif: 'image/avif', bmp: 'image/bmp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif', ico: 'image/x-icon', jfif: 'image/jpeg', jpe: 'image/jpeg', jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff', webp: 'image/webp',
    '3g2': 'video/3gpp2', '3gp': 'video/3gpp', avi: 'video/x-msvideo', flv: 'video/x-flv', m4v: 'video/x-m4v', mkv: 'video/x-matroska', mov: 'video/quicktime', mp4: 'video/mp4', mpeg: 'video/mpeg', mpg: 'video/mpeg', ogv: 'video/ogg', ts: 'video/mp2t', webm: 'video/webm', wmv: 'video/x-ms-wmv'
  }
  return known[extension] ?? `${kind}/unknown`
}

export function dataUrlToBytes(dataUrl: string) {
  const [header, encoded = ''] = dataUrl.split(',', 2)
  const mimeType = header.match(/^data:([^;]+)/)?.[1] ?? 'application/octet-stream'
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return { bytes, mimeType }
}

export function dataUrlToBlob(dataUrl: string) {
  const { bytes, mimeType } = dataUrlToBytes(dataUrl)
  return new Blob([bytes], { type: mimeType })
}

export function contentMediaBlob(content: { mediaBlob?: Blob; dataUrl?: string; mimeType?: string }) {
  if (content.mediaBlob) return content.mediaBlob
  if (content.dataUrl) return dataUrlToBlob(content.dataUrl)
  throw new Error('Media content has no binary data')
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadText(text: string, name: string) {
  downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), name)
}

export function canShareBlob(blob: Blob, name: string) {
  if (!navigator.share) return false
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' })
  try { return !navigator.canShare || navigator.canShare({ files: [file] }) } catch { return false }
}

export async function shareBlob(blob: Blob, name: string, title = name) {
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' })
  if (!canShareBlob(blob, name)) return false
  try {
    await navigator.share({ title, files: [file] })
    return true
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return true
    return false
  }
}

export function shareTextFile(text: string, name: string) {
  return shareBlob(new Blob([text], { type: 'text/plain' }), name)
}

export async function createWorkspaceZip(
  nodes: Record<string, FileNode>,
  contents: Record<string, { text: string; mediaBlob?: Blob; dataUrl?: string }>
) {
  const paths = new Map<string, string>()
  const pathFor = (node: FileNode): string => {
    const cached = paths.get(node.id)
    if (cached) return cached
    const parent = node.parentId ? nodes[node.parentId] : undefined
    if (node.parentId && !parent) throw new Error(`Cannot export node ${node.id} with a missing parent`)
    const path = parent ? `${pathFor(parent)}/${node.name}` : node.name
    paths.set(node.id, path)
    return path
  }
  const entries: Record<string, Uint8Array> = {}
  const files = Object.values(nodes).filter((node) => node.kind === 'file')
  const reservedPaths = new Set<string>()
  const exports = files.map((node) => {
    const content = contents[node.id]
    if (!content) throw new Error(`Cannot export file ${node.id} without content`)
    const path = pathFor(node)
    if (reservedPaths.has(path)) throw new Error(`Cannot export duplicate path: ${path}`)
    reservedPaths.add(path)
    return { content, path }
  })
  await Promise.all(exports.map(async ({ content, path }) => {
    entries[path] = content.mediaBlob || content.dataUrl ? new Uint8Array(await contentMediaBlob(content).arrayBuffer()) : strToU8(content.text)
  }))
  return new Blob([zipSync(entries, { level: 6 }) as BlobPart], { type: 'application/zip' })
}

export async function workspaceZip(
  nodes: Record<string, FileNode>,
  contents: Record<string, { text: string; mediaBlob?: Blob; dataUrl?: string }>,
  workspaceName: string
) {
  downloadBlob(await createWorkspaceZip(nodes, contents), `${workspaceName}.zip`)
}

export async function shareWorkspace(
  nodes: Record<string, FileNode>,
  contents: Record<string, { text: string; mediaBlob?: Blob; dataUrl?: string }>,
  workspaceName: string
) {
  return shareBlob(await createWorkspaceZip(nodes, contents), `${workspaceName}.zip`, workspaceName)
}

export function canShareWorkspace(workspaceName: string) {
  return canShareBlob(new Blob([], { type: 'application/zip' }), `${workspaceName}.zip`)
}

export async function collectDirectory(
  handle: FileSystemDirectoryHandle,
  path: string[] = []
): Promise<Array<{ file: File; path: string[]; handle: FileSystemFileHandle }>> {
  const result: Array<{ file: File; path: string[]; handle: FileSystemFileHandle }> = []
  for await (const entry of handle.values()) {
    if (entry.kind === 'file') result.push({ file: await entry.getFile(), path, handle: entry })
    else result.push(...await collectDirectory(entry, [...path, entry.name]))
  }
  return result
}

type DroppedEntry = { file: File; path: string[]; handle?: FileSystemFileHandle }

export async function collectDroppedItems(items: DataTransferItem[]): Promise<DroppedEntry[]> {
  const output: DroppedEntry[] = []
  const modernItems = items as Array<DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemFileHandle | FileSystemDirectoryHandle | null> }>
  const handlePromises = modernItems.map((item) => item.kind === 'file' && item.getAsFileSystemHandle ? item.getAsFileSystemHandle().catch(() => null) : null)
  const legacyEntries = modernItems.map((item) => (item as DataTransferItem & { webkitGetAsEntry?: () => LegacyEntry | null }).webkitGetAsEntry?.() ?? null)
  const plainFiles = modernItems.map((item) => item.getAsFile())
  for (let index = 0; index < modernItems.length; index += 1) {
    const item = modernItems[index]
    if (item.kind !== 'file') continue
    if (handlePromises[index]) {
      const handle = await handlePromises[index]
      if (handle) {
        if (handle.kind === 'file') output.push({ file: await handle.getFile(), path: [], handle })
        else output.push(...(await collectDirectory(handle)).map((entry) => ({ ...entry, path: [handle.name, ...entry.path] })))
        continue
      }
    }
    const legacy = legacyEntries[index]
    const file = plainFiles[index]
    if (legacy?.isDirectory) output.push(...await readLegacyEntry(legacy, []))
    else if (file) output.push({ file, path: [] })
    else if (legacy) output.push(...await readLegacyEntry(legacy, []))
  }
  return output
}

interface LegacyEntry {
  name: string
  isFile: boolean
  isDirectory: boolean
  file?: (success: (file: File) => void, error?: (error: DOMException) => void) => void
  createReader?: () => { readEntries: (success: (entries: LegacyEntry[]) => void, error?: (error: DOMException) => void) => void }
}

async function readLegacyEntry(entry: LegacyEntry, path: string[]): Promise<DroppedEntry[]> {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((resolve, reject) => entry.file!(resolve, reject))
    return [{ file, path }]
  }
  if (!entry.isDirectory || !entry.createReader) return []
  const reader = entry.createReader()
  const all: LegacyEntry[] = []
  while (true) {
    const batch = await new Promise<LegacyEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (!batch.length) break
    all.push(...batch)
  }
  const nested = await Promise.all(all.map((child) => readLegacyEntry(child, [...path, entry.name])))
  return nested.flat()
}
