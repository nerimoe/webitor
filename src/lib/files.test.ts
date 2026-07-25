import { afterEach, describe, expect, it, vi } from 'vitest'
import { shareTextFile } from './files'

describe('system sharing', () => {
  afterEach(() => vi.restoreAllMocks())

  it('shares a text document as a file when Web Share supports files', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { configurable: true, value: share })
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
    await shareTextFile('Hello', 'note.txt')
    expect(share).toHaveBeenCalledOnce()
    const payload = share.mock.calls[0][0] as ShareData
    expect(payload.files?.[0].name).toBe('note.txt')
  })
})
