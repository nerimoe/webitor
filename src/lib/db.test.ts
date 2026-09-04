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

  it('round-trips binary content without storing Blob objects', async () => {
    const state = initialPersistedState()
    state.nodes.binary = { id: 'binary', parentId: null, name: 'file.bin', kind: 'file', order: 0, source: 'drop' }
    state.contents.binary = { fileId: 'binary', text: '', contentKind: 'binary', mediaBlob: new Blob([new Uint8Array([1, 2, 3])], { type: 'application/octet-stream' }), mimeType: 'application/octet-stream', version: 1, status: 'local-only' }
    await saveState(state)

    const db = await openDB('local-ide', 1)
    const stored = await db.get('state', 'current') as { contents: { binary: { mediaBlob?: Blob; dataUrl?: string; mediaBytes: ArrayBuffer } } }
    expect(stored.contents.binary.mediaBlob).toBeUndefined()
    expect(stored.contents.binary.dataUrl).toBeUndefined()
    expect(new Uint8Array(stored.contents.binary.mediaBytes)).toEqual(new Uint8Array([1, 2, 3]))

    const restored = await loadState()
    expect(restored?.contents.binary.mediaBlob).toBeInstanceOf(Blob)
    expect(new Uint8Array(await restored!.contents.binary.mediaBlob!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('distinguishes an unreadable workspace snapshot from IndexedDB access failure', async () => {
    const db = await openDB('local-ide', 1)
    await db.put('state', { schemaVersion: 5, broken: true }, 'current')

    await expect(loadState()).rejects.toBeInstanceOf(WorkspaceStateLoadError)
  })
})
