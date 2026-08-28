import { inflateSync, strFromU8, unzip, zipSync, type Unzipped } from 'fflate'

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
  'txt', 'md', 'markdown', 'mdown', 'mkd', 'json', 'js', 'mjs', 'cjs', 'ts', 'mts', 'cts',
  'tsx', 'jsx', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'xml', 'yaml', 'yml',
  'toml', 'ini', 'conf', 'config', 'env', 'sh', 'bash', 'zsh', 'fish', 'py', 'rb',
  'rs', 'go', 'java', 'kt', 'c', 'cpp', 'h', 'hpp', 'cs', 'php', 'swift', 'sql',
  'graphql', 'gql', 'svg', 'vue', 'svelte', 'astro', 'dockerfile', 'makefile', 'csv', 'tsv', 'log'
])

const imageExtensions = new Set([
  'png', 'jpg', 'jpeg', 'jpe', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico', 'tif', 'tiff', 'heic', 'heif', 'dds'
])

const videoExtensions = new Set([
  'mp4', 'webm', 'ogv', 'mov', 'm4v', 'mkv', 'avi', 'wmv', 'flv', '3gp'
])

const audioExtensions = new Set([
  'mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'
])

export function getFileExtension(name: string): string {
  const parts = name.split('.')
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : ''
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
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif',
    bmp: 'image/bmp', ico: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff',
    dds: 'image/vnd-ms.dds',
    mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime',
    m4v: 'video/x-m4v', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
    aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/opus',
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
  const sampleLength = Math.min(data.length, 4096)
  let nullBytes = 0
  for (let i = 0; i < sampleLength; i += 1) {
    if (data[i] === 0) nullBytes += 1
  }
  return nullBytes === 0
}

export function decodeZipText(data: Uint8Array): string {
  try {
    return strFromU8(data)
  } catch {
    try {
      return new TextDecoder('utf-8', { fatal: false }).decode(data)
    } catch {
      try {
        return new TextDecoder('gb18030').decode(data)
      } catch {
        return strFromU8(data, true)
      }
    }
  }
}

function decodeFilename(nameBytes: Uint8Array, isUtf8Flag: boolean): string {
  if (isUtf8Flag) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(nameBytes)
    } catch {
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(nameBytes)
  } catch {
    try {
      return new TextDecoder('gb18030').decode(nameBytes)
    } catch {
      try {
        return new TextDecoder('shift-jis').decode(nameBytes)
      } catch {
        return strFromU8(nameBytes, true)
      }
    }
  }
}

function sortEntries(entries: ZipEntry[]): ZipEntry[] {
  return entries.sort((a, b) => {
    if (a.path === b.path) return 0
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

function parseViaCentralDirectory(bytes: Uint8Array): ZipEntry[] | null {
  if (bytes.length < 22) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocdOffset = -1
  const maxSearchLength = Math.min(bytes.length, 65557)
  const minOffset = bytes.length - maxSearchLength
  for (let i = bytes.length - 22; i >= minOffset; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i
      break
    }
  }

  if (eocdOffset === -1) return null

  const totalEntries = view.getUint16(eocdOffset + 10, true)
  const cdOffset = view.getUint32(eocdOffset + 16, true)

  if (cdOffset >= bytes.length) return null

  let offset = cdOffset
  const entryMap = new Map<string, ZipEntry>()

  for (let i = 0; i < totalEntries && offset + 46 <= bytes.length; i += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) break

    const flags = view.getUint16(offset + 8, true)
    const method = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const uncompressedSize = view.getUint32(offset + 24, true)
    const nameLen = view.getUint16(offset + 28, true)
    const extraLen = view.getUint16(offset + 30, true)
    const commentLen = view.getUint16(offset + 32, true)
    const localHeaderOffset = view.getUint32(offset + 42, true)

    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLen)
    const isUtf8Flag = (flags & (1 << 11)) !== 0
    const rawPath = decodeFilename(nameBytes, isUtf8Flag)

    const normalized = rawPath.replace(/\\/g, '/').replace(/^\/+/, '')
    if (normalized) {
      const isDir = normalized.endsWith('/') || (uncompressedSize === 0 && rawPath.endsWith('/'))
      const cleanPath = isDir ? normalized.replace(/\/+$/, '') : normalized

      if (cleanPath) {
        let data = new Uint8Array(0)
        if (!isDir && uncompressedSize > 0 && localHeaderOffset + 30 <= bytes.length) {
          try {
            const localNameLen = view.getUint16(localHeaderOffset + 26, true)
            const localExtraLen = view.getUint16(localHeaderOffset + 28, true)
            const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen
            const compressedData = bytes.subarray(dataOffset, dataOffset + compressedSize)

            if (method === 0) {
              data = new Uint8Array(compressedData)
            } else if (method === 8) {
              data = inflateSync(compressedData)
            }
          } catch (e) {
            console.warn(`Failed to decompress entry ${cleanPath}:`, e)
            data = new Uint8Array(0)
          }
        }

        const pathParts = cleanPath.split('/')
        const name = pathParts[pathParts.length - 1]
        const depth = pathParts.length - 1

        entryMap.set(cleanPath, {
          path: cleanPath,
          name,
          dir: isDir,
          size: uncompressedSize || data.length,
          data,
          depth
        })

        let currentAncestor = ''
        for (let j = 0; j < pathParts.length - 1; j += 1) {
          currentAncestor = currentAncestor ? `${currentAncestor}/${pathParts[j]}` : pathParts[j]
          if (!entryMap.has(currentAncestor)) {
            entryMap.set(currentAncestor, {
              path: currentAncestor,
              name: pathParts[j],
              dir: true,
              size: 0,
              data: new Uint8Array(0),
              depth: j
            })
          }
        }
      }
    }
    offset += 46 + nameLen + extraLen + commentLen
  }

  if (!entryMap.size) return null
  return sortEntries(Array.from(entryMap.values()))
}

export async function parseZipArchive(buffer: ArrayBuffer | Uint8Array): Promise<ZipEntry[]> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)

  try {
    const cdEntries = parseViaCentralDirectory(bytes)
    if (cdEntries && cdEntries.length > 0) {
      return cdEntries
    }
  } catch (cdErr) {
    console.warn('Central directory parse attempt failed, falling back to streaming unzip:', cdErr)
  }

  const unzipped = await new Promise<Unzipped>((resolve, reject) => {
    unzip(bytes, (err, result) => {
      if (err) reject(err)
      else resolve(result)
    })
  })

  const rawEntries = Object.entries(unzipped)
  const entryMap = new Map<string, ZipEntry>()

  for (const [rawPath, data] of rawEntries) {
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

  return sortEntries(Array.from(entryMap.values()))
}

export function createZipBlob(entries: Record<string, Uint8Array>): Blob {
  const zipped = zipSync(entries, { level: 6 })
  return new Blob([zipped as BlobPart], { type: 'application/zip' })
}
