const API_PREFIX = '/api/shares/'
const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{16}$/
const CONTENT_HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/
const MAX_BODY_BYTES = 2 * 1024 * 1024
const SHARE_ID_BYTES = 12

function response(status: number, body?: string) {
  return new Response(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  })
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

function expirationFrom(env: Env) {
  const ttl = Number(env.SHARE_TTL_SECONDS)
  if (!Number.isSafeInteger(ttl) || ttl <= 0) throw new TypeError('SHARE_TTL_SECONDS must be a positive integer')
  return Date.now() + ttl * 1000
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith(API_PREFIX)) return env.ASSETS.fetch(request)

    const id = url.pathname.slice(API_PREFIX.length)
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

      const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
      const { success } = await env.UPLOAD_RATE_LIMITER.limit({ key: ip })
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
} satisfies ExportedHandler<Env>
