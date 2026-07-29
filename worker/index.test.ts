import { beforeEach, describe, expect, it, vi } from 'vitest'
import worker, { PickupCode } from './index'

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
  const get = vi.fn().mockResolvedValue(null)
  const put = vi.fn().mockResolvedValue({})
  const deleteObject = vi.fn().mockResolvedValue(undefined)
  const limit = vi.fn().mockResolvedValue({ success: true })
  const pickupIpLimit = vi.fn().mockResolvedValue({ success: true })
  const pickupCodeLimit = vi.fn().mockResolvedValue({ success: true })
  const pickupFetch = vi.fn(async (input: RequestInfo | URL) => new Response(null, { status: String(input).endsWith('/claim') ? 201 : 404 }))
  const getByName = vi.fn(() => ({ fetch: pickupFetch }))
  const env = {
    ASSETS: { fetch: vi.fn() },
    SHARES: { head, get, put, delete: deleteObject },
    UPLOAD_RATE_LIMITER: { limit },
    PICKUP_IP_RATE_LIMITER: { limit: pickupIpLimit },
    PICKUP_CODE_RATE_LIMITER: { limit: pickupCodeLimit },
    PICKUP_CODES: { getByName },
    SHARE_TTL_SECONDS: '604800',
    PICKUP_TTL_SECONDS: '600'
  } as unknown as Env
  return { env, head, get, put, deleteObject, limit, pickupIpLimit, pickupCodeLimit, pickupFetch, getByName }
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

describe('pickup API boundary', () => {
  let setup: ReturnType<typeof createEnv>

  beforeEach(() => { setup = createEnv() })

  it('creates a six-digit, ten-minute pickup code for a bounded body', async () => {
    const result = await callWorker(new Request('https://webitor.example/api/pickups', {
      method: 'POST',
      body: new Uint8Array([1, 2, 3])
    }), setup.env)
    const created = await result.json<{ code: string, expiresAt: number }>()

    expect(result.status).toBe(201)
    expect(created.code).toMatch(/^\d{6}$/)
    expect(created.expiresAt).toBeGreaterThan(Date.now() + 599_000)
    expect(created.expiresAt).toBeLessThanOrEqual(Date.now() + 600_000)
    expect(setup.put).toHaveBeenCalledOnce()
    expect(setup.put.mock.calls[0][0]).toMatch(/^pickup\//)
    expect(setup.getByName).toHaveBeenCalledWith(created.code)
  })

  it('rejects an oversized pickup before storing it', async () => {
    const result = await callWorker(new Request('https://webitor.example/api/pickups', {
      method: 'POST',
      headers: { 'Content-Length': String(MAX_BODY_BYTES + 1) },
      body: new Uint8Array([1])
    }), setup.env)

    expect(result.status).toBe(413)
    expect(setup.put).not.toHaveBeenCalled()
    expect(setup.limit).not.toHaveBeenCalled()
  })

  it('rate-limits pickup attempts by both client and code', async () => {
    setup.pickupCodeLimit.mockResolvedValue({ success: false })
    const result = await callWorker(new Request('https://webitor.example/api/pickups/123456'), setup.env)

    expect(result.status).toBe(429)
    expect(setup.pickupIpLimit).toHaveBeenCalledOnce()
    expect(setup.pickupCodeLimit).toHaveBeenCalledWith({ key: '123456' })
    expect(setup.pickupFetch).not.toHaveBeenCalled()
  })
})

describe('pickup code durable object', () => {
  it('returns a stored file once and removes both the code and object', async () => {
    const values = new Map<string, unknown>()
    const transaction = {
      get: vi.fn(async (key: string) => values.get(key)),
      put: vi.fn(async (key: string, value: unknown) => { values.set(key, value) }),
      delete: vi.fn(async (key: string) => values.delete(key)),
      setAlarm: vi.fn().mockResolvedValue(undefined),
      deleteAlarm: vi.fn().mockResolvedValue(undefined)
    }
    const storage = {
      ...transaction,
      transaction: vi.fn(async (callback: (txn: typeof transaction) => Promise<unknown>) => callback(transaction)),
      setAlarm: vi.fn().mockResolvedValue(undefined),
      deleteAlarm: vi.fn().mockResolvedValue(undefined)
    }
    const bytes = new Uint8Array([9, 8, 7])
    const deleteObject = vi.fn().mockResolvedValue(undefined)
    const env = {
      SHARES: {
        get: vi.fn().mockResolvedValue({ size: bytes.byteLength, arrayBuffer: async () => bytes.buffer }),
        delete: deleteObject
      }
    } as unknown as Env
    const cleanup: Promise<unknown>[] = []
    const object = new PickupCode({ storage, waitUntil: (promise: Promise<unknown>) => cleanup.push(promise) } as unknown as DurableObjectState, env)
    const expiresAt = Date.now() + 60_000

    expect((await object.fetch(new Request('https://pickup.internal/claim', {
      method: 'POST', body: JSON.stringify({ objectKey: 'pickup/object', expiresAt })
    }))).status).toBe(201)
    const first = await object.fetch(new Request('https://pickup.internal/take', { method: 'POST' }))
    await Promise.all(cleanup)
    const second = await object.fetch(new Request('https://pickup.internal/take', { method: 'POST' }))

    expect(first.status).toBe(200)
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(bytes)
    expect(second.status).toBe(404)
    expect(deleteObject).toHaveBeenCalledWith('pickup/object')
  })

  it('deletes an unclaimed object when its alarm expires', async () => {
    const record = { objectKey: 'pickup/expired', expiresAt: Date.now() - 1 }
    const deleteRecord = vi.fn().mockResolvedValue(true)
    const deleteObject = vi.fn().mockResolvedValue(undefined)
    const object = new PickupCode({
      storage: {
        get: vi.fn().mockResolvedValue(record),
        delete: deleteRecord
      }
    } as unknown as DurableObjectState, {
      SHARES: { delete: deleteObject }
    } as unknown as Env)

    await object.alarm()

    expect(deleteRecord).toHaveBeenCalledWith('record')
    expect(deleteObject).toHaveBeenCalledWith('pickup/expired')
  })
})
