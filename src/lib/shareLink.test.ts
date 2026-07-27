import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFileShareUrl, readFileShareUrl, ShareLinkError, shareOrCopyFileUrl, type ShareLinkProgress } from './shareLink'

const storedShares = new Map<string, Uint8Array>()
const uploadHeaders = new Map<string, Headers>()

function shareId(input: RequestInfo | URL) {
  return String(input).split('/').at(-1) ?? ''
}

beforeEach(() => {
  storedShares.clear()
  uploadHeaders.clear()
  vi.restoreAllMocks()
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const id = shareId(input)
    if (init?.method === 'PUT') {
      storedShares.set(id, new Uint8Array(init.body as ArrayBufferLike))
      uploadHeaders.set(id, new Headers(init.headers))
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
    const createProgress: ShareLinkProgress[] = []
    const url = await createFileShareUrl({ name: 'notes.md', text }, 'https://webitor.example/editor', (progress) => createProgress.push(progress))

    expect(url).toMatch(/^https:\/\/webitor\.example\/editor\?share=[A-Za-z0-9_-]{16}#key=[A-Za-z0-9_-]{43}$/)
    expect(url.length).toBeLessThan(150)
    expect(url).not.toContain('notes')
    const id = new URL(url).searchParams.get('share')!
    const stored = storedShares.get(id)!
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', stored as BufferSource))
    const encodedDigest = btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(uploadHeaders.get(id)?.get('X-Content-SHA256')).toBe(encodedDigest)
    expect(id).toBe(encodedDigest.slice(0, 16))
    expect(stored[0]).toBe(2)
    expect(new TextDecoder().decode([...storedShares.values()][0])).not.toContain(text.slice(0, 20))
    expect(createProgress.map(({ phase }) => phase)).toEqual(['compressing', 'encrypting', 'uploading'])
    const readProgress: ShareLinkProgress[] = []
    await expect(readFileShareUrl(url, (progress) => readProgress.push(progress))).resolves.toEqual({ name: 'notes.md', text })
    expect(readProgress.map(({ phase }) => phase)).toEqual(['downloading', 'downloading', 'decrypting'])
    expect(readProgress[1].progress).toBe(1)
  })

  it('keeps supported image bytes and metadata encrypted', async () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo='
    const url = await createFileShareUrl({ name: 'pixel.png', text: '', dataUrl, mimeType: 'image/png' }, 'https://webitor.example/')

    expect(url.length).toBeLessThan(150)
    const shared = await readFileShareUrl(url)
    expect({ ...shared, mediaBlob: undefined }).toEqual({ name: 'pixel.png', text: '', mediaBlob: undefined, mimeType: 'image/png', contentKind: 'image' })
    expect(new Uint8Array(await shared.mediaBlob!.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
  })

  it('keeps video bytes and media kind encrypted', async () => {
    const mediaBytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])
    const url = await createFileShareUrl({ name: 'clip.mp4', text: '', mediaBlob: new Blob([mediaBytes as BlobPart], { type: 'video/mp4' }), mimeType: 'video/mp4', contentKind: 'video' }, 'https://webitor.example/')
    const shared = await readFileShareUrl(url)
    expect({ ...shared, mediaBlob: undefined }).toEqual({ name: 'clip.mp4', text: '', mediaBlob: undefined, mimeType: 'video/mp4', contentKind: 'video' })
    expect(new Uint8Array(await shared.mediaBlob!.arrayBuffer())).toEqual(mediaBytes)
  })

  it('round-trips custom binary formats without treating them as text', async () => {
    const bytes = new Uint8Array([0, 255, 65, 66, 67, 0])
    const url = await createFileShareUrl({ name: 'form.abcd', text: '', mediaBlob: new Blob([bytes], { type: 'application/x-abcd' }), mimeType: 'application/x-abcd', contentKind: 'binary' }, 'https://webitor.example/')
    const shared = await readFileShareUrl(url)
    expect({ ...shared, mediaBlob: undefined }).toEqual({ name: 'form.abcd', text: '', mediaBlob: undefined, mimeType: 'application/x-abcd', contentKind: 'binary' })
    expect(new Uint8Array(await shared.mediaBlob!.arrayBuffer())).toEqual(bytes)
  })

  it('rejects a key that cannot authenticate the ciphertext', async () => {
    const url = new URL(await createFileShareUrl({ name: 'secret.txt', text: 'secret' }, 'https://webitor.example/'))
    const key = url.hash.slice('#key='.length)
    url.hash = `key=${key.startsWith('A') ? 'B' : 'A'}${key.slice(1)}`

    await expect(readFileShareUrl(url.toString())).rejects.toMatchObject({ code: 'invalid' } satisfies Partial<ShareLinkError>)
  })

  it('continues to read version 1 links', async () => {
    const id = 'AAAAAAAAAAAAAAAA'
    const keyBytes = crypto.getRandomValues(new Uint8Array(32))
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const name = new TextEncoder().encode('legacy.txt')
    const text = new TextEncoder().encode('Legacy content')
    const payload = new Uint8Array(1 + 6 + name.length + text.length)
    payload[1] = 1
    new DataView(payload.buffer).setUint16(3, name.length)
    payload.set(name, 7)
    payload.set(text, 7 + name.length)
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt'])
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({
      name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(id), tagLength: 128
    }, key, payload))
    const stored = new Uint8Array(1 + iv.length + encrypted.length)
    stored[0] = 1
    stored.set(iv, 1)
    stored.set(encrypted, 1 + iv.length)
    storedShares.set(id, stored)
    const encodedKey = btoa(String.fromCharCode(...keyBytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

    await expect(readFileShareUrl(`https://webitor.example/?share=${id}#key=${encodedKey}`))
      .resolves.toEqual({ name: 'legacy.txt', text: 'Legacy content' })
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
