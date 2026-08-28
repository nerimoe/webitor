import { unzip, zipSync, strFromU8, type Unzipped } from 'fflate'

export interface ZipEntry {
  path: string
  name: string
  dir: boolean
  size: number
  data: Uint8Array
  depth: number
}

export type ZipEntryKind = 'text' | 'markdown' | 'image' | 'video' | 'audio' | 'zip' | 'binary'

const textExtensions = new Set([
  'txt', 'text', 'log', 'md', 'markdown', 'mdown', 'mkd',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'json', 'jsonc', 'json5',
  'html', 'htm', 'xhtml', 'css', 'scss', 'sass', 'less',
  'py', 'pyw', 'java', 'c', 'h', 'cc', 'cpp', 'hpp', 'cxx', 'hxx',
  'rs', 'go', 'sql', 'xml', 'svg', 'yaml', 'yml', 'toml', 'ini',
  'cfg', 'conf', 'properties', 'env', 'sh', 'bash', 'zsh', 'fish',
  'bat', 'cmd', 'ps1', 'vue', 'svelte', 'astro', 'graphql', 'gql',
  'csv', 'tsv', 'diff', 'patch', 'lock', 'editorconfig', 'gitignore',
  'npmrc', 'dockerfile', 'makefile', 'cmake'
])

const imageExtensions = new Set([
  'png', 'jpg', 'jpeg', 'jpe', 'jfif', 'gif', 'webp', 'svg', 'avif',
  'bmp', 'ico', 'tif', 'tiff'
])

const videoExtensions = new Set([
  'mp4', 'webm', 'ogv', 'mov', 'm4v', 'mkv', 'avi', 'wmv', 'flv', '3gp', 'ts'
])

const audioExtensions = new Set([
  'mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus', 'weba'
])

export function getFileExtension(name: string): string {
  const base = name.split('/').pop() ?? name
  const index = base.lastIndexOf('.')
  return index > 0 ? base.slice(index + 1).toLowerCase() : ''
}

export function inferEntryKind(name: string): ZipEntryKind {
  const ext = getFileExtension(name)
  if (['md', 'markdown', 'mdown', 'mkd'].includes(ext)) return 'markdown'
  if (ext === 'zip') return 'zip'
  if (textExtensions.has(ext)) return 'text'
  if (imageExtensions.has(ext)) return 'image'
  if (videoExtensions.has(ext)) return 'video'
  if (audioExtensions.has(ext)) return 'audio'
  return 'binary'
}

export function inferMimeType(name: string): string {
  const ext = getFileExtension(name)
  const mimeMap: Record<string, string> = {
    // Images
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif',
    bmp: 'image/bmp', ico: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff',
    // Videos
    mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime',
    m4v: 'video/x-m4v', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
    // Audios
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
    aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/opus',
    // Text / Data
    txt: 'text/plain;charset=utf-8', md: 'text/markdown;charset=utf-8',
    html: 'text/html;charset=utf-8', htm: 'text/html;charset=utf-8',
    css: 'text/css;charset=utf-8', js: 'text/javascript;charset=utf-8',
    ts: 'text/typescript;charset=utf-8', json: 'application/json;charset=utf-8',
    xml: 'application/xml;charset=utf-8', yaml: 'text/yaml;charset=utf-8',
    yml: 'text/yaml;charset=utf-8', csv: 'text/csv;charset=utf-8',
    zip: 'application/zip', pdf: 'application/pdf'
  }
  return mimeMap[ext] ?? 'application/octet-stream'
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / Math.pow(1024, index)
  if (index === 0) return `${Math.round(value)} B`
  const formatted = Number(value.toFixed(2))
  return `${formatted} ${units[index]}`
}

export function isProbablyUtf8(data: Uint8Array): boolean {
  if (!data.length) return true
  // Check first 4096 bytes for null bytes or control characters
  const sampleLength = Math.min(data.length, 4096)
  let nullBytes = 0
  for (let i = 0; i < sampleLength; i += 1) {
    if (data[i] === 0) nullBytes += 1
  }
  // If more than 0 null bytes, likely binary
  return nullBytes === 0
}

export function decodeZipText(data: Uint8Array): string {
  try {
    return strFromU8(data)
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(data)
  }
}

export async function parseZipArchive(buffer: ArrayBuffer | Uint8Array): Promise<ZipEntry[]> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const unzipped = await new Promise<Unzipped>((resolve, reject) => {
    unzip(bytes, (err, result) => {
      if (err) reject(err)
      else resolve(result)
    })
  })

  const rawEntries = Object.entries(unzipped)
  const entryMap = new Map<string, ZipEntry>()

  for (const [rawPath, data] of rawEntries) {
    // Normalize path separators and remove leading slashes
    const normalized = rawPath.replace(/\\/g, '/').replace(/^\/+/, '')
    if (!normalized) continue

    const isDir = normalized.endsWith('/') || (data.length === 0 && rawPath.endsWith('/'))
    const cleanPath = isDir ? normalized.replace(/\/+$/, '') : normalized
    if (!cleanPath) continue

    const pathParts = cleanPath.split('/')
    const name = pathParts[pathParts.length - 1]
    const depth = pathParts.length - 1

    entryMap.set(cleanPath, {
      path: cleanPath,
      name,
      dir: isDir,
      size: data.length,
      data,
      depth
    })

    // Synthesize parent directories if not already in the zip
    let currentAncestor = ''
    for (let i = 0; i < pathParts.length - 1; i += 1) {
      currentAncestor = currentAncestor ? `${currentAncestor}/${pathParts[i]}` : pathParts[i]
      if (!entryMap.has(currentAncestor)) {
        entryMap.set(currentAncestor, {
          path: currentAncestor,
          name: pathParts[i],
          dir: true,
          size: 0,
          data: new Uint8Array(0),
          depth: i
        })
      }
    }
  }

  // Sort entries: directories first at each level, then alphabetically by path
  return Array.from(entryMap.values()).sort((a, b) => {
    if (a.path === b.path) return 0
    // Group by common parent directory
    const aParts = a.path.split('/')
    const bParts = b.path.split('/')
    const minLen = Math.min(aParts.length, bParts.length)

    for (let i = 0; i < minLen; i += 1) {
      if (aParts[i] !== bParts[i]) {
        const aIsLast = i === aParts.length - 1
        const bIsLast = i === bParts.length - 1
        const aIsDir = !aIsLast || a.dir
        const bIsDir = !bIsLast || b.dir
        if (aIsDir !== bIsDir) return aIsDir ? -1 : 1
        return aParts[i].localeCompare(bParts[i], undefined, { numeric: true, sensitivity: 'base' })
      }
    }
    return aParts.length - bParts.length
  })
}

export function createZipBlob(entries: Record<string, Uint8Array>): Blob {
  const zipped = zipSync(entries, { level: 6 })
  return new Blob([zipped as BlobPart], { type: 'application/zip' })
}
