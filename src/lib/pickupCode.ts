import {
  decodeCompressedFile,
  encodeCompressedFile,
  MAX_TRANSFER_BYTES,
  ShareLinkError,
  type ShareFileInput,
  type SharedFile
} from './shareLink'

const API_PATH = '/api/pickups'
const CODE_PATTERN = /^\d{6}$/

export type PickupProgress = {
  phase: 'compressing' | 'uploading' | 'downloading'
  progress?: number
}

export interface CreatedPickupCode {
  code: string
  expiresAt: number
}

type ProgressHandler = (progress: PickupProgress) => void

function fail(code: ConstructorParameters<typeof ShareLinkError>[0], message: string): never {
  throw new ShareLinkError(code, message)
}

function parseCreatedCode(value: unknown): CreatedPickupCode {
  if (typeof value !== 'object' || value === null) return fail('invalid', 'The pickup response is invalid')
  const { code, expiresAt } = value as Record<string, unknown>
  if (typeof code !== 'string' || !CODE_PATTERN.test(code) || typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) {
    return fail('invalid', 'The pickup response is invalid')
  }
  return { code, expiresAt }
}

async function readBoundedResponse(response: Response, onProgress?: ProgressHandler) {
  const contentLength = response.headers.get('Content-Length')
  const declaredLength = contentLength === null ? null : Number(contentLength)
  if (declaredLength !== null && (!Number.isSafeInteger(declaredLength) || declaredLength < 0)) {
    return fail('invalid', 'The pickup response has an invalid length')
  }
  if (declaredLength !== null && declaredLength > MAX_TRANSFER_BYTES) return fail('tooLarge', 'The pickup exceeds the size limit')
  onProgress?.({ phase: 'downloading', progress: declaredLength && declaredLength > 0 ? 0 : undefined })
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > MAX_TRANSFER_BYTES) return fail('tooLarge', 'The pickup exceeds the size limit')
    return bytes
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_TRANSFER_BYTES) {
      await reader.cancel()
      return fail('tooLarge', 'The pickup exceeds the size limit')
    }
    chunks.push(value)
    onProgress?.({ phase: 'downloading', progress: declaredLength && declaredLength > 0 ? Math.min(1, size / declaredLength) : undefined })
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export async function createPickupCode(input: ShareFileInput, onProgress?: ProgressHandler) {
  onProgress?.({ phase: 'compressing' })
  const payload = await encodeCompressedFile(input)
  if (payload.byteLength > MAX_TRANSFER_BYTES) return fail('tooLarge', 'The file is too large for pickup')

  let response: Response
  try {
    onProgress?.({ phase: 'uploading' })
    response = await fetch(API_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: payload
    })
  } catch { return fail('network', 'The pickup service is unavailable') }
  if (response.status === 413) return fail('tooLarge', 'The file is too large for pickup')
  if (response.status === 429) return fail('rateLimited', 'Too many pickups were created')
  if (!response.ok) return fail('network', 'The pickup could not be created')
  let value: unknown
  try { value = await response.json() } catch { return fail('invalid', 'The pickup response is invalid') }
  return parseCreatedCode(value)
}

export async function receivePickupCode(code: string, onProgress?: ProgressHandler): Promise<SharedFile> {
  if (!CODE_PATTERN.test(code)) return fail('invalid', 'The pickup code must contain six digits')
  let response: Response
  try {
    response = await fetch(`${API_PATH}/${code}`, { cache: 'no-store' })
  } catch { return fail('network', 'The pickup service is unavailable') }
  if (response.status === 404) return fail('notFound', 'The pickup code was not found')
  if (response.status === 410) return fail('expired', 'The pickup code has expired')
  if (response.status === 413) return fail('tooLarge', 'The pickup exceeds the size limit')
  if (response.status === 429) return fail('rateLimited', 'Too many pickup attempts')
  if (!response.ok) return fail('network', 'The pickup could not be downloaded')
  return decodeCompressedFile(await readBoundedResponse(response, onProgress))
}

export async function copyPickupCode(code: string) {
  if (!CODE_PATTERN.test(code)) return fail('invalid', 'The pickup code must contain six digits')
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(code)
    return
  }
  const input = document.createElement('input')
  input.value = code
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.append(input)
  input.select()
  const copied = document.execCommand('copy')
  input.remove()
  if (!copied) return fail('network', 'The pickup code could not be copied')
}
