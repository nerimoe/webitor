import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.resetModules()
  delete window.launchQueue
})

describe('system file launches', () => {
  it('buffers a launch until the workspace consumer is ready', async () => {
    let launch: ((params: LaunchParams) => void) | null = null
    window.launchQueue = { setConsumer: (next) => { launch = next } }
    const module = await import('./fileLaunch')
    const handle = { kind: 'file', name: 'opened.txt' } as FileSystemFileHandle

    ;(launch as unknown as (params: LaunchParams) => void)({ files: [handle], targetURL: 'https://webitor.example/' })
    const consume = vi.fn()
    module.subscribeToFileLaunch(consume)

    expect(consume).toHaveBeenCalledWith([handle])
  })

  it('delivers later launches directly to the active consumer', async () => {
    let launch: ((params: LaunchParams) => void) | null = null
    window.launchQueue = { setConsumer: (next) => { launch = next } }
    const module = await import('./fileLaunch')
    const consume = vi.fn()
    module.subscribeToFileLaunch(consume)
    const handle = { kind: 'file', name: 'later.md' } as FileSystemFileHandle

    ;(launch as unknown as (params: LaunchParams) => void)({ files: [handle], targetURL: 'https://webitor.example/' })

    expect(consume).toHaveBeenCalledWith([handle])
  })
})
