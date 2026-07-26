import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  loadState: vi.fn(),
  saveState: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../lib/db', () => db)

import { initialPersistedState, useWorkspace } from './useWorkspace'

describe('workspace hydration', () => {
  beforeEach(() => {
    db.loadState.mockReset()
    db.saveState.mockClear()
    useWorkspace.setState({ ...initialPersistedState(), hydrated: false, notice: null, selectedNodeId: null })
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
})
