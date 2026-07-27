import { beforeEach, describe, expect, it, vi } from 'vitest'
import worker from './index'

const MAX_BODY_BYTES = 2 * 1024 * 1024

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function identity(body: Uint8Array) {
  const bytes = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return { hash: base64Url(digest), id: base64Url(digest.subarray(0, 12)) }
}

function createEnv() {
  const head = vi.fn<() => Promise<R2Object | null>>().mockResolvedValue(null)
  const put = vi.fn().mockResolvedValue({})
  const deleteObject = vi.fn().mockResolvedValue(undefined)
  const limit = vi.fn().mockResolvedValue({ success: true })
  const env = {
    ASSETS: { fetch: vi.fn() },
    SHARES: { head, put, delete: deleteObject },
    UPLOAD_RATE_LIMITER: { limit },
    SHARE_TTL_SECONDS: '604800'
  } as unknown as Env
  return { env, head, put, deleteObject, limit }
}

function context() {
  return { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {} } as unknown as ExecutionContext
}

function callWorker(request: Request, env: Env) {
  return worker.fetch(request as never, env, context())
}

async function putRequest(body: Uint8Array, id: string, hash: string, headers?: HeadersInit) {
  return new Request(`https://webitor.example/api/shares/${id}`, {
    method: 'PUT',
    headers: { 'X-Content-SHA256': hash, ...headers },
    body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer
  })
}

describe('share upload boundary', () => {
  let setup: ReturnType<typeof createEnv>

  beforeEach(() => { setup = createEnv() })

  it('rejects a declared body larger than the upload limit', async () => {
    const body = new Uint8Array([1])
    const { hash, id } = await identity(body)
    const request = await putRequest(body, id, hash, { 'Content-Length': String(MAX_BODY_BYTES + 1) })
    const result = await callWorker(request, setup.env)

    expect(result.status).toBe(413)
    expect(setup.put).not.toHaveBeenCalled()
  })

  it('rejects an actual body larger than the upload limit', async () => {
    const body = new Uint8Array(MAX_BODY_BYTES + 1)
    const { hash, id } = await identity(body)
    const result = await callWorker(await putRequest(body, id, hash), setup.env)

    expect(result.status).toBe(413)
    expect(setup.put).not.toHaveBeenCalled()
  })

  it('rejects missing, mismatched, and incorrectly addressed hashes', async () => {
    const body = new Uint8Array([1, 2, 3])
    const { hash, id } = await identity(body)
    const missing = new Request(`https://webitor.example/api/shares/${id}`, { method: 'PUT', body: body.buffer as ArrayBuffer })
    expect((await callWorker(missing, setup.env)).status).toBe(400)
    expect((await callWorker(await putRequest(body, id, 'A'.repeat(43)), setup.env)).status).toBe(400)
    expect((await callWorker(await putRequest(body, 'AAAAAAAAAAAAAAAA', hash), setup.env)).status).toBe(400)
    expect(setup.put).not.toHaveBeenCalled()
  })

  it('stores a new upload with its verified content hash and expiration', async () => {
    const body = new Uint8Array([4, 5, 6])
    const { hash, id } = await identity(body)
    const result = await callWorker(await putRequest(body, id, hash), setup.env)

    expect(result.status).toBe(201)
    expect(setup.limit).toHaveBeenCalledOnce()
    expect(setup.put).toHaveBeenCalledOnce()
    expect(setup.put.mock.calls[0][0]).toBe(id)
    expect(setup.put.mock.calls[0][2].customMetadata.contentHash).toBe(hash)
    expect(Number(setup.put.mock.calls[0][2].customMetadata.expiresAt)).toBeGreaterThan(Date.now())
  })

  it('deduplicates an unexpired upload before consuming the rate limit', async () => {
    const body = new Uint8Array([7, 8, 9])
    const { hash, id } = await identity(body)
    setup.head.mockResolvedValue({ customMetadata: { contentHash: hash, expiresAt: String(Date.now() + 60_000) } } as unknown as R2Object)
    const result = await callWorker(await putRequest(body, id, hash), setup.env)

    expect(result.status).toBe(200)
    expect(setup.limit).not.toHaveBeenCalled()
    expect(setup.put).not.toHaveBeenCalled()
  })

  it('rejects a full-hash collision for the same short ID', async () => {
    const body = new Uint8Array([10, 11, 12])
    const { hash, id } = await identity(body)
    setup.head.mockResolvedValue({ customMetadata: { contentHash: 'B'.repeat(43), expiresAt: String(Date.now() + 60_000) } } as unknown as R2Object)
    const result = await callWorker(await putRequest(body, id, hash), setup.env)

    expect(result.status).toBe(409)
    expect(setup.limit).not.toHaveBeenCalled()
    expect(setup.put).not.toHaveBeenCalled()
  })

  it('replaces expired content even when its old full hash differs', async () => {
    const body = new Uint8Array([13, 14, 15])
    const { hash, id } = await identity(body)
    setup.head.mockResolvedValue({ customMetadata: { contentHash: 'C'.repeat(43), expiresAt: String(Date.now() - 1) } } as unknown as R2Object)
    const result = await callWorker(await putRequest(body, id, hash), setup.env)

    expect(result.status).toBe(201)
    expect(setup.deleteObject).toHaveBeenCalledWith(id)
    expect(setup.put).toHaveBeenCalledOnce()
  })
})
