import { dataUrlToBytes } from './files'
import type { FileContent } from '../types'

const SHARE_PARAM = 'share'
const KEY_PARAM = 'key'
const API_PATH = '/api/shares'
const FILE_PAYLOAD_VERSION = 1
const LEGACY_ENCRYPTED_PAYLOAD_VERSION = 1
const ENCRYPTED_PAYLOAD_VERSION = 2
const ENCRYPTED_PAYLOAD_AAD = new TextEncoder().encode('webitor-share-v2')
const SHARE_ID_BYTES = 12
const AES_KEY_BYTES = 32
const IV_BYTES = 12
const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_ENCRYPTED_BYTES = 2 * 1024 * 1024

interface ShareFileInput {
  name: string
  text: string
  mediaBlob?: Blob
  dataUrl?: string
  mimeType?: string
  contentKind?: FileContent['contentKind']
}

export interface SharedFile {
  name: string
  text: string
  mediaBlob?: Blob
  mimeType?: string
  contentKind?: FileContent['contentKind']
}

export type ShareLinkProgress = {
  phase: 'compressing' | 'encrypting' | 'uploading' | 'downloading' | 'decrypting'
  progress?: number
}

type ProgressHandler = (progress: ShareLinkProgress) => void

export type ShareLinkErrorCode =
  | 'missing'
  | 'invalid'
  | 'tooLarge'
  | 'unsupportedCompression'
  | 'unsupportedMedia'
  | 'unsupportedVersion'
  | 'notFound'
  | 'expired'
  | 'network'
  | 'rateLimited'

export class ShareLinkError extends Error {
  constructor(public code: ShareLinkErrorCode, message: string) {
    super(message)
    this.name = 'ShareLinkError'
  }
}

const fail = (code: ShareLinkErrorCode, message: string): never => { throw new ShareLinkError(code, message) }

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function bytesToBase64Url(bytes: Uint8Array) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(encoded: string, expectedLength?: number) {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return fail('invalid', 'The share key is not valid base64url')
  try {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - encoded.length % 4) % 4)
    const binary = atob(padded)
    if (expectedLength !== undefined && binary.length !== expectedLength) return fail('invalid', 'The share key has an invalid length')
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch (error) {
    if (error instanceof ShareLinkError) throw error
    return fail('invalid', 'The share key is corrupt')
  }
}

async function transform(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, maximumSize: number) {
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    }
  })
  const reader = input.pipeThrough(stream as TransformStream<Uint8Array, Uint8Array>).getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maximumSize) {
        await reader.cancel()
        return fail('tooLarge', 'The shared file exceeds the size limit')
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof ShareLinkError) throw error
    return fail('invalid', 'The compressed shared file is corrupt')
  }
  const output = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function safeName(name: string) {
  const value = name.split(/[\\/]/).at(-1)?.trim().slice(0, 255)
  return value || fail('invalid', 'The shared file has no valid name')
}

function supportedBinaryMime(value: string) {
  const match = /^([a-z0-9!#$&^_.+-]+)\/[a-z0-9!#$&^_.+-]+$/i.exec(value)
  if (!match) return fail('unsupportedMedia', 'The shared file type is not supported')
  const topLevel = match[1].toLowerCase()
  const contentKind = topLevel === 'image' || topLevel === 'video' ? topLevel : 'binary'
  return { mimeType: value, contentKind: contentKind as 'binary' | 'image' | 'video' }
}

async function encodeFilePayload(input: ShareFileInput) {
  const name = new TextEncoder().encode(safeName(input.name))
  const encodedMedia = input.mediaBlob
    ? { bytes: new Uint8Array(await input.mediaBlob.arrayBuffer()), mimeType: input.mimeType || input.mediaBlob.type }
    : input.dataUrl ? dataUrlToBytes(input.dataUrl) : null
  const media = encodedMedia ? supportedBinaryMime(input.mimeType || encodedMedia.mimeType) : null
  if (media && input.contentKind && input.contentKind !== media.contentKind) return fail('unsupportedMedia', 'The shared media type does not match its content')
  const mimeType = media?.mimeType ?? ''
  const mime = new TextEncoder().encode(mimeType)
  const body = encodedMedia?.bytes ?? new TextEncoder().encode(input.text)
  if (body.byteLength > MAX_FILE_BYTES || name.byteLength > 0xffff || mime.byteLength > 0xffff) {
    return fail('tooLarge', 'The file is too large to share')
  }
  const output = new Uint8Array(6 + name.byteLength + mime.byteLength + body.byteLength)
  output[0] = FILE_PAYLOAD_VERSION
  output[1] = encodedMedia ? 1 : 0
  const view = new DataView(output.buffer)
  view.setUint16(2, name.byteLength)
  view.setUint16(4, mime.byteLength)
  output.set(name, 6)
  output.set(mime, 6 + name.byteLength)
  output.set(body, 6 + name.byteLength + mime.byteLength)
  return output
}

function decodeFilePayload(bytes: Uint8Array): SharedFile {
  if (bytes.byteLength < 6) return fail('invalid', 'The shared file header is truncated')
  if (bytes[0] !== FILE_PAYLOAD_VERSION) return fail('unsupportedVersion', 'The shared file version is not supported')
  if (bytes[1] !== 0 && bytes[1] !== 1) return fail('invalid', 'The shared file type is invalid')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const nameLength = view.getUint16(2)
  const mimeLength = view.getUint16(4)
  const bodyOffset = 6 + nameLength + mimeLength
  if (bodyOffset > bytes.byteLength) return fail('invalid', 'The shared file header is truncated')
  const decoder = new TextDecoder()
  const name = safeName(decoder.decode(bytes.subarray(6, 6 + nameLength)))
  const body = bytes.subarray(bodyOffset)
  if (bytes[1] === 0) return { name, text: decoder.decode(body) }
  const media = supportedBinaryMime(decoder.decode(bytes.subarray(6 + nameLength, bodyOffset)))
  return { name, text: '', mediaBlob: new Blob([body as BlobPart], { type: media.mimeType }), mimeType: media.mimeType, contentKind: media.contentKind }
}

async function encodeCompressedFile(input: ShareFileInput) {
  const source = await encodeFilePayload(input)
  if (typeof CompressionStream !== 'function') {
    const output = new Uint8Array(1 + source.byteLength)
    output.set(source, 1)
    return output
  }
  const gzip = await transform(source, new CompressionStream('gzip'), MAX_FILE_BYTES)
  const compressed = gzip.byteLength < source.byteLength
  const body = compressed ? gzip : source
  const output = new Uint8Array(1 + body.byteLength)
  output[0] = compressed ? 1 : 0
  output.set(body, 1)
  return output
}

async function decodeCompressedFile(bytes: Uint8Array) {
  if (!bytes.byteLength) return fail('invalid', 'The shared file is empty')
  if (bytes[0] === 0) return decodeFilePayload(bytes.subarray(1))
  if (bytes[0] !== 1) return fail('unsupportedCompression', 'The shared file compression is not supported')
  if (typeof DecompressionStream !== 'function') return fail('unsupportedCompression', 'This browser cannot decompress shared files')
  return decodeFilePayload(await transform(bytes.subarray(1), new DecompressionStream('gzip'), MAX_FILE_BYTES))
}

function randomBytes(length: number) {
  return crypto.getRandomValues(new Uint8Array(length))
}

async function importAesKey(bytes: Uint8Array, usage: 'encrypt' | 'decrypt') {
  return crypto.subtle.importKey('raw', bytes as BufferSource, { name: 'AES-GCM' }, false, [usage])
}

function shareIdFrom(url: URL) {
  const id = url.searchParams.get(SHARE_PARAM)
  if (!id || !/^[A-Za-z0-9_-]{16}$/.test(id)) return fail('missing', 'The encrypted share ID is missing')
  return id
}

function shareKeyFrom(url: URL) {
  const value = new URLSearchParams(url.hash.slice(1)).get(KEY_PARAM)
  if (!value) return fail('missing', 'The encrypted share key is missing')
  return base64UrlToBytes(value, AES_KEY_BYTES)
}

export function hasFileShareMarker(search = location.search) {
  return new URLSearchParams(search).has(SHARE_PARAM)
}

export function cleanFileShareUrl() {
  const clean = new URL(location.href)
  clean.searchParams.delete(SHARE_PARAM)
  clean.hash = ''
  history.replaceState(null, '', `${clean.pathname}${clean.search}`)
}

export async function createFileShareUrl(input: ShareFileInput, baseUrl = location.href, onProgress?: ProgressHandler) {
  onProgress?.({ phase: 'compressing' })
  const payload = await encodeCompressedFile(input)
  const keyBytes = randomBytes(AES_KEY_BYTES)
  const iv = randomBytes(IV_BYTES)
  const key = await importAesKey(keyBytes, 'encrypt')
  onProgress?.({ phase: 'encrypting' })
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv,
    additionalData: ENCRYPTED_PAYLOAD_AAD,
    tagLength: 128
  }, key, payload as BufferSource))
  const stored = new Uint8Array(1 + iv.byteLength + encrypted.byteLength)
  stored[0] = ENCRYPTED_PAYLOAD_VERSION
  stored.set(iv, 1)
  stored.set(encrypted, 1 + iv.byteLength)
  if (stored.byteLength > MAX_ENCRYPTED_BYTES) return fail('tooLarge', 'The encrypted file is too large to share')
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', stored as BufferSource))
  const id = bytesToBase64Url(digest.subarray(0, SHARE_ID_BYTES))
  const contentHash = bytesToBase64Url(digest)

  let response: Response
  try {
    onProgress?.({ phase: 'uploading' })
    response = await fetch(`${API_PATH}/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Content-SHA256': contentHash
      },
      body: stored
    })
  } catch { return fail('network', 'The encrypted share service is unavailable') }
  if (response.status === 413) return fail('tooLarge', 'The encrypted file is too large to share')
  if (response.status === 429) return fail('rateLimited', 'Too many encrypted shares were created')
  if (!response.ok) return fail('network', 'The encrypted share could not be stored')

  const url = new URL(baseUrl)
  url.searchParams.set(SHARE_PARAM, id)
  url.hash = `${KEY_PARAM}=${bytesToBase64Url(keyBytes)}`
  return url.toString()
}

async function readEncryptedResponse(response: Response, onProgress?: ProgressHandler) {
  const declaredLength = Number(response.headers.get('Content-Length') ?? 0)
  if (declaredLength > MAX_ENCRYPTED_BYTES) return fail('tooLarge', 'The encrypted share exceeds the size limit')
  onProgress?.({ phase: 'downloading', progress: declaredLength > 0 ? 0 : undefined })
  if (!response.body) return new Uint8Array(await response.arrayBuffer())

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_ENCRYPTED_BYTES) {
      await reader.cancel()
      return fail('tooLarge', 'The encrypted share exceeds the size limit')
    }
    chunks.push(value)
    onProgress?.({ phase: 'downloading', progress: declaredLength > 0 ? Math.min(1, size / declaredLength) : undefined })
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export async function readFileShareUrl(href = location.href, onProgress?: ProgressHandler): Promise<SharedFile> {
  const url = new URL(href)
  const id = shareIdFrom(url)
  const keyBytes = shareKeyFrom(url)
  let response: Response
  try {
    response = await fetch(`${API_PATH}/${id}`, { cache: 'no-store' })
  } catch { return fail('network', 'The encrypted share service is unavailable') }
  if (response.status === 404) return fail('notFound', 'The encrypted share was not found')
  if (response.status === 410) return fail('expired', 'The encrypted share has expired')
  if (!response.ok) return fail('network', 'The encrypted share could not be downloaded')
  const stored = await readEncryptedResponse(response, onProgress)
  if (stored.byteLength > MAX_ENCRYPTED_BYTES) return fail('tooLarge', 'The encrypted share exceeds the size limit')
  if (stored.byteLength <= 1 + IV_BYTES || (stored[0] !== ENCRYPTED_PAYLOAD_VERSION && stored[0] !== LEGACY_ENCRYPTED_PAYLOAD_VERSION)) {
    return fail('unsupportedVersion', 'The encrypted share version is not supported')
  }
  const iv = stored.subarray(1, 1 + IV_BYTES)
  const ciphertext = stored.subarray(1 + IV_BYTES)
  const key = await importAesKey(keyBytes, 'decrypt')
  let plaintext: ArrayBuffer
  try {
    onProgress?.({ phase: 'decrypting' })
    plaintext = await crypto.subtle.decrypt({
      name: 'AES-GCM',
      iv,
      additionalData: stored[0] === LEGACY_ENCRYPTED_PAYLOAD_VERSION ? new TextEncoder().encode(id) : ENCRYPTED_PAYLOAD_AAD,
      tagLength: 128
    }, key, ciphertext as BufferSource)
  } catch { return fail('invalid', 'The encrypted share key or data is invalid') }
  return decodeCompressedFile(new Uint8Array(plaintext))
}

export async function shareOrCopyFileUrl(url: string, title: string): Promise<'shared' | 'copied'> {
  if (navigator.share) {
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
  if (!copied) return fail('network', 'The encrypted share link could not be copied')
  return 'copied'
}
