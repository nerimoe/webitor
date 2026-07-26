import { beforeEach, describe, expect, it } from 'vitest'
import { openDB } from 'idb'
import { clearState, loadState, saveState, WorkspaceStateLoadError } from './db'
import { initialPersistedState } from '../store/useWorkspace'

describe('workspace persistence', () => {
  beforeEach(async () => clearState())

  it('round-trips a workspace snapshot through IndexedDB', async () => {
    const state = initialPersistedState()
    state.workspace.name = 'Recovered project'
    await saveState(state)
    expect((await loadState())?.workspace.name).toBe('Recovered project')
  })

  it('distinguishes an unreadable workspace snapshot from IndexedDB access failure', async () => {
    const db = await openDB('local-ide', 1)
    await db.put('state', { schemaVersion: 5, broken: true }, 'current')

    await expect(loadState()).rejects.toBeInstanceOf(WorkspaceStateLoadError)
  })
})
