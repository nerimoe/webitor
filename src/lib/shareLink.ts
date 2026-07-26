const SHARE_PREFIX = '#share='
const MAX_SHARE_BYTES = 8 * 1024 * 1024

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

type SharePayload = { v: 1; n: string; t?: string; d?: string; m?: string }

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(encoded: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('Invalid shared file encoding')
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - encoded.length % 4) % 4)
  const binary = atob(padded)
  if (binary.length > MAX_SHARE_BYTES) throw new Error('Shared file is too large')
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
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
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_SHARE_BYTES) {
      await reader.cancel()
      throw new Error('Shared file is too large')
    }
    chunks.push(value)
  }
  const output = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

export async function createFileShareUrl(input: ShareFileInput) {
  const payload: SharePayload = input.dataUrl
    ? { v: 1, n: input.name, d: input.dataUrl, m: input.mimeType }
    : { v: 1, n: input.name, t: input.text }
  const source = new TextEncoder().encode(JSON.stringify(payload))
  if (source.byteLength > MAX_SHARE_BYTES) throw new Error('File is too large to share in a URL')
  const gzip = typeof CompressionStream === 'function'
    ? await transform(source, new CompressionStream('gzip'))
    : null
  const compressed = gzip && gzip.byteLength < source.byteLength ? gzip : source
  const format = compressed === gzip ? 'g' : 'u'
  const base = `${location.origin}${location.pathname}${location.search}`
  return `${base}${SHARE_PREFIX}${format}.${bytesToBase64Url(compressed)}`
}

export async function readFileShareHash(hash: string): Promise<SharedFile | null> {
  if (!hash.startsWith(SHARE_PREFIX)) return null
  const [format, encoded] = hash.slice(SHARE_PREFIX.length).split('.', 2)
  if (!encoded || (format !== 'g' && format !== 'u')) throw new Error('Unsupported shared file format')
  let bytes = base64UrlToBytes(encoded)
  if (format === 'g') {
    if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot decompress the shared file')
    bytes = await transform(bytes, new DecompressionStream('gzip'))
  }
  const payload = JSON.parse(new TextDecoder().decode(bytes)) as Partial<SharePayload>
  if (payload.v !== 1 || typeof payload.n !== 'string') throw new Error('Invalid shared file')
  const name = payload.n.split(/[\\/]/).at(-1)?.trim().slice(0, 255)
  if (!name) throw new Error('Invalid shared file name')
  if (typeof payload.d === 'string') {
    const mimeType = typeof payload.m === 'string' ? payload.m : payload.d.match(/^data:([^;,]+)/)?.[1]
    if (!mimeType || !/^image\/(png|jpeg|gif|webp|avif)$/i.test(mimeType) || !payload.d.startsWith(`data:${mimeType}`)) {
      throw new Error('Unsupported shared image')
    }
    return { name, text: '', dataUrl: payload.d, mimeType }
  }
  if (typeof payload.t !== 'string') throw new Error('Invalid shared file content')
  return { name, text: payload.t }
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
  if (!copied) throw new Error('Could not copy share link')
  return 'copied'
}
