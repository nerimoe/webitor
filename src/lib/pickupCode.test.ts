import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPickupCode, receivePickupCode, type PickupProgress } from './pickupCode'
import { ShareLinkError } from './shareLink'

let stored: Uint8Array | null

beforeEach(() => {
  stored = null
  vi.restoreAllMocks()
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/pickups' && init?.method === 'POST') {
      stored = new Uint8Array(init.body as ArrayBufferLike)
      return Response.json({ code: '482193', expiresAt: Date.now() + 600_000 }, { status: 201 })
    }
    if (String(input) === '/api/pickups/482193' && stored) {
      const bytes = stored
      stored = null
      const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      return new Response(body, { headers: { 'Content-Length': String(bytes.byteLength) } })
    }
    return new Response(null, { status: 404 })
  }))
})

describe('pickup codes', () => {
  it('round-trips a compressed document and reports transfer progress', async () => {
    const createProgress: PickupProgress[] = []
    await expect(createPickupCode({ name: 'note.md', text: 'Pickup content'.repeat(100) }, (value) => createProgress.push(value)))
      .resolves.toMatchObject({ code: '482193' })
    expect(createProgress.map(({ phase }) => phase)).toEqual(['compressing', 'uploading'])

    const receiveProgress: PickupProgress[] = []
    await expect(receivePickupCode('482193', (value) => receiveProgress.push(value)))
      .resolves.toEqual({ name: 'note.md', text: 'Pickup content'.repeat(100) })
    expect(receiveProgress.at(-1)).toMatchObject({ phase: 'downloading', progress: 1 })
    await expect(receivePickupCode('482193')).rejects.toMatchObject({ code: 'notFound' } satisfies Partial<ShareLinkError>)
  })

  it('rejects malformed codes before making a request', async () => {
    await expect(receivePickupCode('12345')).rejects.toMatchObject({ code: 'invalid' } satisfies Partial<ShareLinkError>)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('maps expired and rate-limited responses', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 410 }))
    await expect(receivePickupCode('123456')).rejects.toMatchObject({ code: 'expired' } satisfies Partial<ShareLinkError>)
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 429 }))
    await expect(receivePickupCode('123456')).rejects.toMatchObject({ code: 'rateLimited' } satisfies Partial<ShareLinkError>)
  })
})
