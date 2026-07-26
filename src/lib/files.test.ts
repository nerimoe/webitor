import { afterEach, describe, expect, it, vi } from 'vitest'
import { shareTextFile } from './files'

describe('system sharing', () => {
  const originalShare = navigator.share
  const originalCanShare = navigator.canShare

  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(navigator, 'share', { configurable: true, value: originalShare })
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: originalCanShare })
  })

  it('shares a text document as a file when Web Share supports files', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { configurable: true, value: share })
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
    await shareTextFile('Hello', 'note.txt')
    expect(share).toHaveBeenCalledOnce()
    const payload = share.mock.calls[0][0] as ShareData
    expect(payload.files?.[0].name).toBe('note.txt')
  })

  it('does not turn an unavailable share action into a download', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
    expect(await shareTextFile('Hello', 'note.txt')).toBe(false)
    expect(click).not.toHaveBeenCalled()
  })
})
