const SHARE_API_PREFIX = '/api/shares/'
const PICKUP_API_PATH = '/api/pickups'
const PICKUP_API_PREFIX = `${PICKUP_API_PATH}/`
const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{16}$/
const CONTENT_HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/
const PICKUP_CODE_PATTERN = /^\d{6}$/
const MAX_BODY_BYTES = 2 * 1024 * 1024
const SHARE_ID_BYTES = 12
const PICKUP_CODE_SPACE = 900_000
const PICKUP_CODE_OFFSET = 100_000
const PICKUP_CODE_ATTEMPTS = 12

interface PickupRecord {
  objectKey: string
  expiresAt: number
  claimId?: string
}

function response(status: number, body?: BodyInit | null, headers?: HeadersInit) {
  return new Response(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers
    }
  })
}

function jsonResponse(status: number, value: unknown) {
  return response(status, JSON.stringify(value), { 'Content-Type': 'application/json' })
}

async function readBoundedBody(request: Request) {
  const contentLength = request.headers.get('Content-Length')
  if (contentLength !== null) {
    const declaredLength = Number(contentLength)
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) throw new TypeError('Invalid Content-Length')
    if (declaredLength > MAX_BODY_BYTES) return null
  }
  if (!request.body) return new Uint8Array()

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }

  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function hashBody(body: Uint8Array) {
  const bytes = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return {
    contentHash: bytesToBase64Url(digest),
    shareId: bytesToBase64Url(digest.subarray(0, SHARE_ID_BYTES))
  }
}

function positiveSeconds(value: string, name: string) {
  const seconds = Number(value)
  if (!Number.isSafeInteger(seconds) || seconds <= 0) throw new TypeError(`${name} must be a positive integer`)
  return seconds
}

function expirationFrom(env: Env) {
  return Date.now() + positiveSeconds(env.SHARE_TTL_SECONDS, 'SHARE_TTL_SECONDS') * 1000
}

function pickupExpirationFrom(env: Env) {
  return Date.now() + positiveSeconds(env.PICKUP_TTL_SECONDS, 'PICKUP_TTL_SECONDS') * 1000
}

function randomPickupCode() {
  const maximum = Math.floor(0x1_0000_0000 / PICKUP_CODE_SPACE) * PICKUP_CODE_SPACE
  const random = new Uint32Array(1)
  do crypto.getRandomValues(random)
  while (random[0] >= maximum)
  return String(PICKUP_CODE_OFFSET + random[0] % PICKUP_CODE_SPACE)
}

function clientIp(request: Request) {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown'
}

async function handleShare(request: Request, env: Env, ctx: ExecutionContext, id: string) {
  if (!SHARE_ID_PATTERN.test(id) || id.includes('/')) return response(404)

  if (request.method === 'PUT') {
    const claimedHash = request.headers.get('X-Content-SHA256')
    if (!claimedHash || !CONTENT_HASH_PATTERN.test(claimedHash)) return response(400, 'Invalid content hash')

    let body: Uint8Array | null
    try {
      body = await readBoundedBody(request)
    } catch (error) {
      if (error instanceof TypeError) return response(400, error.message)
      throw error
    }
    if (!body || body.byteLength === 0) return response(body ? 400 : 413)
    const { contentHash, shareId } = await hashBody(body)
    if (contentHash !== claimedHash) return response(400, 'Content hash mismatch')
    if (shareId !== id) return response(400, 'Share ID does not match content')

    const existing = await env.SHARES.head(id)
    if (existing) {
      const existingHash = existing.customMetadata?.contentHash
      const expiresAt = Number(existing.customMetadata?.expiresAt)
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        await env.SHARES.delete(id)
      } else if (existingHash === contentHash) {
        return response(200)
      } else if (existingHash) {
        return response(409, 'Share ID collision')
      } else {
        await env.SHARES.delete(id)
      }
    }

    const { success } = await env.UPLOAD_RATE_LIMITER.limit({ key: clientIp(request) })
    if (!success) return response(429, 'Too many share uploads')

    const expiresAt = expirationFrom(env)
    await env.SHARES.put(id, body, {
      customMetadata: { contentHash, expiresAt: String(expiresAt) },
      httpMetadata: { contentType: 'application/octet-stream' }
    })
    return response(201)
  }

  if (request.method === 'GET') {
    const object = await env.SHARES.get(id)
    if (!object) return response(404)

    const expiresAt = Number(object.customMetadata?.expiresAt ?? 0)
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      ctx.waitUntil(env.SHARES.delete(id))
      return response(410)
    }

    return new Response(object.body, {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(object.size),
        'X-Content-Type-Options': 'nosniff'
      }
    })
  }

  return response(405)
}

async function createPickup(request: Request, env: Env) {
  if (request.method !== 'POST') return response(405)
  let body: Uint8Array | null
  try {
    body = await readBoundedBody(request)
  } catch (error) {
    if (error instanceof TypeError) return response(400, error.message)
    throw error
  }
  if (!body || body.byteLength === 0) return response(body ? 400 : 413)

  const { success } = await env.UPLOAD_RATE_LIMITER.limit({ key: clientIp(request) })
  if (!success) return response(429, 'Too many pickup uploads')

  const objectKey = `pickup/${crypto.randomUUID()}`
  const expiresAt = pickupExpirationFrom(env)
  await env.SHARES.put(objectKey, body, {
    customMetadata: { expiresAt: String(expiresAt) },
    httpMetadata: { contentType: 'application/octet-stream' }
  })

  try {
    for (let attempt = 0; attempt < PICKUP_CODE_ATTEMPTS; attempt += 1) {
      const code = randomPickupCode()
      const stub = env.PICKUP_CODES.getByName(code)
      const result = await stub.fetch('https://pickup.internal/claim', {
        method: 'POST',
        body: JSON.stringify({ objectKey, expiresAt })
      })
      if (result.status === 201) return jsonResponse(201, { code, expiresAt })
      if (result.status !== 409) throw new Error(`Pickup code claim failed with ${result.status}`)
    }
  } catch (error) {
    await env.SHARES.delete(objectKey)
    throw error
  }

  await env.SHARES.delete(objectKey)
  return response(503, 'No pickup code is currently available')
}

async function receivePickup(request: Request, env: Env, code: string) {
  if (request.method !== 'GET') return response(405)
  if (!PICKUP_CODE_PATTERN.test(code)) return response(404)

  const [ipLimit, codeLimit] = await Promise.all([
    env.PICKUP_IP_RATE_LIMITER.limit({ key: clientIp(request) }),
    env.PICKUP_CODE_RATE_LIMITER.limit({ key: code })
  ])
  if (!ipLimit.success || !codeLimit.success) return response(429, 'Too many pickup attempts')

  return env.PICKUP_CODES.getByName(code).fetch('https://pickup.internal/take', { method: 'POST' })
}

export class PickupCode {
  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(request: Request) {
    const path = new URL(request.url).pathname
    if (request.method !== 'POST') return response(405)
    if (path === '/claim') return this.claim(request)
    if (path === '/take') return this.take()
    return response(404)
  }

  private async claim(request: Request) {
    const input = await request.json<PickupRecord>()
    if (!input || typeof input.objectKey !== 'string' || !input.objectKey.startsWith('pickup/') || !Number.isFinite(input.expiresAt)) {
      return response(400)
    }

    let expiredObjectKey: string | null = null
    const claimed = await this.state.storage.transaction(async (transaction) => {
      const current = await transaction.get<PickupRecord>('record')
      if (current && current.expiresAt > Date.now()) return false
      if (current) expiredObjectKey = current.objectKey
      await transaction.put('record', input)
      await transaction.setAlarm(input.expiresAt)
      return true
    })
    if (!claimed) return response(409)
    if (expiredObjectKey) this.state.waitUntil(this.env.SHARES.delete(expiredObjectKey))
    return response(201)
  }

  private async take() {
    const claimId = crypto.randomUUID()
    let record: PickupRecord | undefined
    let expired = false
    await this.state.storage.transaction(async (transaction) => {
      const current = await transaction.get<PickupRecord>('record')
      if (!current) return
      if (current.expiresAt <= Date.now()) {
        expired = true
        record = current
        await transaction.delete('record')
        await transaction.deleteAlarm()
        return
      }
      if (current.claimId) return
      record = current
      await transaction.put('record', { ...current, claimId })
      await transaction.deleteAlarm()
    })
    if (!record) return response(404)
    if (expired) {
      await this.env.SHARES.delete(record.objectKey)
      return response(410)
    }

    let object: R2ObjectBody | null
    try {
      object = await this.env.SHARES.get(record.objectKey)
    } catch (error) {
      await this.state.storage.transaction(async (transaction) => {
        const current = await transaction.get<PickupRecord>('record')
        if (current?.claimId === claimId) {
          await transaction.put('record', record!)
          await transaction.setAlarm(record!.expiresAt)
        }
      })
      throw error
    }
    if (!object) {
      await this.state.storage.delete('record')
      return response(404)
    }
    if (object.size > MAX_BODY_BYTES) {
      await Promise.all([this.state.storage.delete('record'), this.env.SHARES.delete(record.objectKey)])
      return response(413)
    }

    let bytes: ArrayBuffer
    try {
      bytes = await object.arrayBuffer()
    } catch (error) {
      await this.state.storage.transaction(async (transaction) => {
        const current = await transaction.get<PickupRecord>('record')
        if (current?.claimId === claimId) {
          await transaction.put('record', record!)
          await transaction.setAlarm(record!.expiresAt)
        }
      })
      throw error
    }

    await this.state.storage.setAlarm(Date.now() + 60_000)
    this.state.waitUntil((async () => {
      await this.env.SHARES.delete(record.objectKey)
      await this.state.storage.delete('record')
      await this.state.storage.deleteAlarm()
    })())
    return response(200, bytes, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(bytes.byteLength)
    })
  }

  async alarm() {
    const record = await this.state.storage.get<PickupRecord>('record')
    if (!record) return
    await this.env.SHARES.delete(record.objectKey)
    await this.state.storage.delete('record')
  }
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith(SHARE_API_PREFIX)) {
      return handleShare(request, env, ctx, url.pathname.slice(SHARE_API_PREFIX.length))
    }
    if (url.pathname === PICKUP_API_PATH) return createPickup(request, env)
    if (url.pathname.startsWith(PICKUP_API_PREFIX)) {
      return receivePickup(request, env, url.pathname.slice(PICKUP_API_PREFIX.length))
    }
    if (url.pathname.startsWith('/api/')) return response(404)
    return env.ASSETS.fetch(request)
  }
} satisfies ExportedHandler<Env>
