import { zipSync, strToU8 } from 'fflate'
import type { FileNode } from '../types'

export function isProbablyText(file: File) {
  if (file.type.startsWith('text/')) return true
  const blocked = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|7z|rar|woff2?|ttf|otf|mp[34]|mov|avi|wasm|exe|dmg)$/i
  return !blocked.test(file.name)
}

export function isSupportedImage(file: File) {
  return /^image\/(png|jpeg|gif|webp|avif)$/i.test(file.type) || /\.(png|jpe?g|gif|webp|avif)$/i.test(file.name)
}

export function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
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

function createWorkspaceZip(
  nodes: Record<string, FileNode>,
  contents: Record<string, { text: string; dataUrl?: string }>
) {
  const paths = new Map<string, string>()
  const pathFor = (node: FileNode): string => {
    const cached = paths.get(node.id)
    if (cached) return cached
    const parent = node.parentId ? nodes[node.parentId] : undefined
    const path = parent ? `${pathFor(parent)}/${node.name}` : node.name
    paths.set(node.id, path)
    return path
  }
  const entries: Record<string, Uint8Array> = {}
  Object.values(nodes).filter((node) => node.kind === 'file').forEach((node) => {
    const content = contents[node.id]
    entries[pathFor(node)] = content?.dataUrl ? dataUrlToBytes(content.dataUrl).bytes : strToU8(content?.text ?? '')
  })
  return new Blob([zipSync(entries, { level: 6 }) as BlobPart], { type: 'application/zip' })
}

export function workspaceZip(
  nodes: Record<string, FileNode>,
  contents: Record<string, { text: string; dataUrl?: string }>,
  workspaceName: string
) {
  downloadBlob(createWorkspaceZip(nodes, contents), `${workspaceName}.zip`)
}

export function shareWorkspace(
  nodes: Record<string, FileNode>,
  contents: Record<string, { text: string; dataUrl?: string }>,
  workspaceName: string
) {
  return shareBlob(createWorkspaceZip(nodes, contents), `${workspaceName}.zip`, workspaceName)
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
