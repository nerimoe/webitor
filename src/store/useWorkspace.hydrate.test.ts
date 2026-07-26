import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  loadState: vi.fn(),
  saveState: vi.fn().mockResolvedValue(undefined),
  WorkspaceStateLoadError: class WorkspaceStateLoadError extends Error {}
}))

vi.mock('../lib/db', () => db)

import { initialPersistedState, useWorkspace } from './useWorkspace'

describe('workspace hydration', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    db.loadState.mockReset()
    db.saveState.mockReset().mockResolvedValue(undefined)
    useWorkspace.setState({ ...initialPersistedState(), hydrated: false, persistenceBlocked: false, notice: null, selectedNodeId: null })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shares one restore task across concurrent callers', async () => {
    const stored = initialPersistedState()
    stored.workspace.name = 'Restored once'
    let finishLoad: ((value: typeof stored) => void) | undefined
    db.loadState.mockReturnValue(new Promise((resolve) => { finishLoad = resolve }))

    const first = useWorkspace.getState().hydrate()
    const second = useWorkspace.getState().hydrate()
    expect(db.loadState).toHaveBeenCalledOnce()

    finishLoad?.(stored)
    await Promise.all([first, second])
    expect(useWorkspace.getState().workspace.name).toBe('Restored once')

    await useWorkspace.getState().hydrate()
    expect(db.loadState).toHaveBeenCalledOnce()
  })

  it('blocks writes after persisted state cannot be restored', async () => {
    db.loadState.mockRejectedValue(new db.WorkspaceStateLoadError())
    await useWorkspace.getState().hydrate()
    expect(useWorkspace.getState().persistenceBlocked).toBe(true)
    expect(useWorkspace.getState().notice).toBe('workspaceRestoreFailed')

    useWorkspace.getState().addFile('recovery.txt', 'kept in memory')
    await useWorkspace.getState().persist()
    expect(db.saveState).not.toHaveBeenCalled()
  })

  it('retries a failed restore while the in-memory workspace is still empty', async () => {
    const stored = initialPersistedState()
    stored.workspace.name = 'Recovered workspace'
    db.loadState.mockRejectedValueOnce(new Error('temporary IndexedDB failure')).mockResolvedValueOnce(stored)

    await useWorkspace.getState().hydrate()
    expect(useWorkspace.getState().persistenceBlocked).toBe(true)
    await useWorkspace.getState().hydrate()

    expect(db.loadState).toHaveBeenCalledTimes(2)
    expect(useWorkspace.getState()).toMatchObject({ persistenceBlocked: false, notice: null, workspace: { name: 'Recovered workspace' } })
  })

  it('does not overwrite documents created in memory after restore failed', async () => {
    db.loadState.mockRejectedValue(new Error('temporary IndexedDB failure'))
    await useWorkspace.getState().hydrate()
    useWorkspace.getState().addFile('recovery.txt', 'kept in memory')

    await useWorkspace.getState().hydrate()
    expect(db.loadState).toHaveBeenCalledOnce()
  })

  it('finishes autosave in an error state when browser storage is full', async () => {
    vi.useFakeTimers()
    useWorkspace.setState({ hydrated: true })
    const file = useWorkspace.getState().addFile('note.txt', 'before')
    await useWorkspace.getState().persist()
    db.saveState.mockRejectedValue(new DOMException('forced quota', 'QuotaExceededError'))

    useWorkspace.getState().updateContent(file, 'after')
    await vi.advanceTimersByTimeAsync(1_100)

    expect(useWorkspace.getState().contents[file].status).toBe('error')
    expect(useWorkspace.getState().notice).toBe('quotaExceeded')
  })
})
