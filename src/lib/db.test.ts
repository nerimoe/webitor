import { beforeEach, describe, expect, it } from 'vitest'
import { clearState, loadState, saveState } from './db'
import { initialPersistedState } from '../store/useWorkspace'

describe('workspace persistence', () => {
  beforeEach(async () => clearState())

  it('round-trips a workspace snapshot through IndexedDB', async () => {
    const state = initialPersistedState()
    state.workspace.name = 'Recovered project'
    await saveState(state)
    expect((await loadState())?.workspace.name).toBe('Recovered project')
  })
})
