import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanShareTargetUrl, hasShareTargetMarker, readShareTargetFiles, ShareTargetError } from './shareTarget'

afterEach(() => vi.restoreAllMocks())

describe('Web Share Target handoff', () => {
  it('reads every cached file and removes the handoff after import', async () => {
    const token = 'a'.repeat(32)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (init?.method === 'DELETE') return new Response(null, { status: 204 })
      const index = Number(url.split('/').at(-1))
      return new Response(index === 0 ? 'First' : 'Second', {
        headers: {
          'Content-Type': 'text/plain',
          'X-Webitor-File-Name': encodeURIComponent(index === 0 ? 'first.txt' : '第二份.md'),
          'X-Webitor-Last-Modified': '1234'
        }
      })
    })

    const handoff = await readShareTargetFiles(`https://webitor.example/?share-target=${token}&count=2`)

    expect(handoff.files.map((file) => [file.name, file.type, file.lastModified])).toEqual([
      ['first.txt', 'text/plain', 1234],
      ['第二份.md', 'text/plain', 1234]
    ])
    expect(await handoff.files[1].text()).toBe('Second')
    await handoff.cleanup()
    expect(fetchMock).toHaveBeenLastCalledWith(`/__share-target/${token}`, { method: 'DELETE' })
  })

  it('rejects invalid handoff descriptors before reading cache entries', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    await expect(readShareTargetFiles('https://webitor.example/?share-target=bad&count=1'))
      .rejects.toBeInstanceOf(ShareTargetError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('recognizes and removes share-target parameters from the current URL', () => {
    history.replaceState(null, '', '/?share-target-error=invalid&keep=yes')
    expect(hasShareTargetMarker()).toBe(true)
    cleanShareTargetUrl()
    expect(location.pathname + location.search).toBe('/?keep=yes')
  })
})
