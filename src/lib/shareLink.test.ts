import { describe, expect, it } from 'vitest'
import { createFileShareUrl, readFileShareHash } from './shareLink'

describe('file share links', () => {
  it('round-trips a compressed text file', async () => {
    const text = 'A local document with repeated text. '.repeat(200)
    const url = await createFileShareUrl({ name: 'notes.md', text })
    const hash = new URL(url).hash
    expect(hash).toMatch(/^#share=[gu]\./)
    await expect(readFileShareHash(hash)).resolves.toEqual({ name: 'notes.md', text })
  })

  it('keeps supported image metadata', async () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo='
    const url = await createFileShareUrl({ name: 'pixel.png', text: '', dataUrl, mimeType: 'image/png' })
    await expect(readFileShareHash(new URL(url).hash)).resolves.toEqual({ name: 'pixel.png', text: '', dataUrl, mimeType: 'image/png' })
  })

  it('rejects malformed share data', async () => {
    await expect(readFileShareHash('#share=u.invalid!')).rejects.toThrow()
  })
})
