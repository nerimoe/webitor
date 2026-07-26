import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFileShareUrl, readFileShareUrl, ShareLinkError, shareOrCopyFileUrl } from './shareLink'

const storedShares = new Map<string, Uint8Array>()

function shareId(input: RequestInfo | URL) {
  return String(input).split('/').at(-1) ?? ''
}

beforeEach(() => {
  storedShares.clear()
  vi.restoreAllMocks()
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const id = shareId(input)
    if (init?.method === 'PUT') {
      storedShares.set(id, new Uint8Array(init.body as ArrayBufferLike))
      return new Response(null, { status: 201 })
    }
    const body = storedShares.get(id)
    if (!body) return new Response(null, { status: 404 })
    const buffer = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer
    return new Response(buffer, { headers: { 'Content-Length': String(body.byteLength) } })
  }))
})

describe('encrypted file share links', () => {
  it('round-trips text through a short encrypted link', async () => {
    const text = 'A local document with repeated text. '.repeat(200)
    const url = await createFileShareUrl({ name: 'notes.md', text }, 'https://webitor.example/editor')

    expect(url).toMatch(/^https:\/\/webitor\.example\/editor\?share=[A-Za-z0-9_-]{16}#key=[A-Za-z0-9_-]{43}$/)
    expect(url.length).toBeLessThan(150)
    expect(url).not.toContain('notes')
    expect(new TextDecoder().decode([...storedShares.values()][0])).not.toContain(text.slice(0, 20))
    await expect(readFileShareUrl(url)).resolves.toEqual({ name: 'notes.md', text })
  })

  it('keeps supported image bytes and metadata encrypted', async () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo='
    const url = await createFileShareUrl({ name: 'pixel.png', text: '', dataUrl, mimeType: 'image/png' }, 'https://webitor.example/')

    expect(url.length).toBeLessThan(150)
    await expect(readFileShareUrl(url)).resolves.toEqual({ name: 'pixel.png', text: '', dataUrl, mimeType: 'image/png' })
  })

  it('rejects a key that cannot authenticate the ciphertext', async () => {
    const url = new URL(await createFileShareUrl({ name: 'secret.txt', text: 'secret' }, 'https://webitor.example/'))
    const key = url.hash.slice('#key='.length)
    url.hash = `key=${key.slice(0, -1)}${key.endsWith('A') ? 'B' : 'A'}`

    await expect(readFileShareUrl(url.toString())).rejects.toMatchObject({ code: 'invalid' } satisfies Partial<ShareLinkError>)
  })

  it.each([
    [404, 'notFound'],
    [410, 'expired']
  ] as const)('maps a %i download response to %s', async (status, code) => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status }))
    const href = 'https://webitor.example/?share=AAAAAAAAAAAAAAAA#key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    await expect(readFileShareUrl(href)).rejects.toMatchObject({ code } satisfies Partial<ShareLinkError>)
  })

  it('reports upload rate limits', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 429 }))
    await expect(createFileShareUrl({ name: 'note.txt', text: 'text' }, 'https://webitor.example/'))
      .rejects.toMatchObject({ code: 'rateLimited' } satisfies Partial<ShareLinkError>)
  })

  it('uses the system share sheet for the short link', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { configurable: true, value: share })
    await expect(shareOrCopyFileUrl('https://webitor.example/?share=id#key=key', 'note.txt')).resolves.toBe('shared')
    expect(share).toHaveBeenCalledOnce()
  })
})
