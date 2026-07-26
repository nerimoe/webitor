import { dataUrlToBytes } from './files'

const SHARE_PREFIX = '#share='
const SHARE_MARKER = 'webitor-share'
const MAX_SHARE_BYTES = 8 * 1024 * 1024
const MAX_SYSTEM_SHARE_URL_LENGTH = 60_000
const V2_MAGIC = [0x57, 0x32] as const

interface ShareFileInput {
  name: string
  text: string
  dataUrl?: string
  mimeType?: string
}

export interface SharedFile {
  name: string
  text: string
  dataUrl?: string
  mimeType?: string
}

export type ShareLinkErrorCode = 'invalid' | 'tooLarge' | 'unsupportedCompression' | 'unsupportedImage' | 'unsupportedVersion'

export class ShareLinkError extends Error {
  constructor(public code: ShareLinkErrorCode, message: string) {
    super(message)
    this.name = 'ShareLinkError'
  }
}

type LegacyPayload = { v: 1; n: string; t?: string; d?: string; m?: string }
type BinaryHeader = { v: 2; n: string; k: 't' | 'i'; m?: string }

const fail = (code: ShareLinkErrorCode, message: string): never => { throw new ShareLinkError(code, message) }

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function bytesToBase64Url(bytes: Uint8Array) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(encoded: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) fail('invalid', 'The shared data is not valid base64url')
  try {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - encoded.length % 4) % 4)
    const binary = atob(padded)
    if (binary.length > MAX_SHARE_BYTES) fail('tooLarge', 'The shared file exceeds the size limit')
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch (error) {
    if (error instanceof ShareLinkError) throw error
    return fail('invalid', 'The shared data is truncated or corrupt')
  }
}

async function transform(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    }
  })
  const reader = input.pipeThrough(stream as unknown as TransformStream<Uint8Array, Uint8Array>).getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_SHARE_BYTES) {
        await reader.cancel()
        fail('tooLarge', 'The expanded shared file exceeds the size limit')
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof ShareLinkError) throw error
    return fail('invalid', 'The compressed shared data is truncated or corrupt')
  }
  const output = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function encodeBinaryPayload(input: ShareFileInput) {
  let header: BinaryHeader
  let body: Uint8Array
  if (input.dataUrl) {
    const image = dataUrlToBytes(input.dataUrl)
    header = { v: 2, n: input.name, k: 'i', m: input.mimeType || image.mimeType }
    body = image.bytes
  } else {
    header = { v: 2, n: input.name, k: 't' }
    body = new TextEncoder().encode(input.text)
  }
  const headerBytes = new TextEncoder().encode(JSON.stringify(header))
  const output = new Uint8Array(6 + headerBytes.byteLength + body.byteLength)
  output.set(V2_MAGIC, 0)
  new DataView(output.buffer).setUint32(2, headerBytes.byteLength)
  output.set(headerBytes, 6)
  output.set(body, 6 + headerBytes.byteLength)
  return output
}

function safeName(value: unknown) {
  if (typeof value !== 'string') return fail('invalid', 'The shared file has no valid name')
  const name = value.split(/[\\/]/).at(-1)?.trim().slice(0, 255)
  return name || fail('invalid', 'The shared file has no valid name')
}

function supportedImageMime(value: unknown) {
  if (typeof value !== 'string' || !/^image\/(png|jpeg|gif|webp|avif)$/i.test(value)) {
    return fail('unsupportedImage', 'The shared image type is not supported')
  }
  return value
}

function decodeBinaryPayload(bytes: Uint8Array): SharedFile {
  if (bytes.byteLength < 6) return fail('invalid', 'The shared file header is truncated')
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(2)
  if (headerLength > bytes.byteLength - 6) return fail('invalid', 'The shared file header is truncated')
  let header: Partial<BinaryHeader>
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(6, 6 + headerLength))) as Partial<BinaryHeader>
  } catch { return fail('invalid', 'The shared file header is corrupt') }
  if (header.v !== 2) return fail('unsupportedVersion', 'The shared file version is not supported')
  const name = safeName(header.n)
  const body = bytes.subarray(6 + headerLength)
  if (header.k === 't') return { name, text: new TextDecoder().decode(body) }
  if (header.k === 'i') {
    const mimeType = supportedImageMime(header.m)
    return { name, text: '', dataUrl: `data:${mimeType};base64,${bytesToBase64(body)}`, mimeType }
  }
  return fail('invalid', 'The shared file content type is invalid')
}

function decodeLegacyPayload(bytes: Uint8Array): SharedFile {
  let payload: Partial<LegacyPayload>
  try { payload = JSON.parse(new TextDecoder().decode(bytes)) as Partial<LegacyPayload> }
  catch { return fail('invalid', 'The shared file data is corrupt') }
  if (payload.v !== 1) return fail('unsupportedVersion', 'The shared file version is not supported')
  const name = safeName(payload.n)
  if (typeof payload.d === 'string') {
    const mimeType = supportedImageMime(typeof payload.m === 'string' ? payload.m : payload.d.match(/^data:([^;,]+)/)?.[1])
    if (!payload.d.startsWith(`data:${mimeType}`)) return fail('invalid', 'The shared image data is corrupt')
    return { name, text: '', dataUrl: payload.d, mimeType }
  }
  if (typeof payload.t !== 'string') return fail('invalid', 'The shared file content is missing')
  return { name, text: payload.t }
}

export function hasFileShareMarker(search = location.search) {
  return new URLSearchParams(search).get(SHARE_MARKER) === '1'
}

export function cleanFileShareUrl() {
  const clean = new URL(location.href)
  clean.hash = ''
  clean.searchParams.delete(SHARE_MARKER)
  history.replaceState(null, '', `${clean.pathname}${clean.search}`)
}

export async function createFileShareUrl(input: ShareFileInput) {
  const source = encodeBinaryPayload(input)
  if (source.byteLength > MAX_SHARE_BYTES) fail('tooLarge', 'The file is too large to share in a URL')
  const gzip = typeof CompressionStream === 'function'
    ? await transform(source, new CompressionStream('gzip'))
    : null
  const encoded = gzip && gzip.byteLength < source.byteLength ? gzip : source
  const format = encoded === gzip ? 'g' : 'u'
  const url = new URL(location.href)
  url.hash = ''
  url.searchParams.set(SHARE_MARKER, '1')
  return `${url.toString()}${SHARE_PREFIX}${format}.${bytesToBase64Url(encoded)}`
}

export async function readFileShareHash(hash: string): Promise<SharedFile | null> {
  if (!hash.startsWith(SHARE_PREFIX)) return null
  const [format, encoded] = hash.slice(SHARE_PREFIX.length).split('.', 2)
  if (!encoded || (format !== 'g' && format !== 'u')) return fail('invalid', 'The shared link is truncated or has an unsupported encoding')
  let bytes = base64UrlToBytes(encoded)
  if (format === 'g') {
    if (typeof DecompressionStream !== 'function') return fail('unsupportedCompression', 'This browser cannot decompress gzip share links')
    bytes = await transform(bytes, new DecompressionStream('gzip'))
  }
  return bytes[0] === V2_MAGIC[0] && bytes[1] === V2_MAGIC[1]
    ? decodeBinaryPayload(bytes)
    : decodeLegacyPayload(bytes)
}

export async function shareOrCopyFileUrl(url: string, title: string): Promise<'shared' | 'copied'> {
  if (url.length <= MAX_SYSTEM_SHARE_URL_LENGTH && navigator.share) {
    try {
      await navigator.share({ title, url })
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'shared'
    }
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url)
    return 'copied'
  }
  const textarea = document.createElement('textarea')
  textarea.value = url
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) fail('invalid', 'The share link could not be copied')
  return 'copied'
}
