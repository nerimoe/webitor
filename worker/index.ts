const API_PREFIX = '/api/shares/'
const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{16}$/
const MAX_BODY_BYTES = 2 * 1024 * 1024

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
  const declaredLength = Number(request.headers.get('Content-Length') ?? 0)
  if (declaredLength > MAX_BODY_BYTES) return null
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

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith(API_PREFIX)) return env.ASSETS.fetch(request)

    const id = url.pathname.slice(API_PREFIX.length)
    if (!SHARE_ID_PATTERN.test(id) || id.includes('/')) return response(404)

    if (request.method === 'PUT') {
      const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
      const { success } = await env.UPLOAD_RATE_LIMITER.limit({ key: ip })
      if (!success) return response(429, 'Too many share uploads')

      const body = await readBoundedBody(request)
      if (!body || body.byteLength === 0) return response(body ? 400 : 413)

      const ttl = Number.parseInt(env.SHARE_TTL_SECONDS, 10)
      const expiresAt = Date.now() + (Number.isFinite(ttl) ? ttl : 604800) * 1000
      await env.SHARES.put(id, body, {
        customMetadata: { expiresAt: String(expiresAt) },
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
