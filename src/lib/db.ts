import { openDB } from 'idb'
import type { PersistedState } from '../types'
import { parsePersistedState } from './persistedState'

// Keep the legacy key so upgrading to Webitor does not orphan existing documents.
const DB_NAME = 'local-ide'
const STATE_KEY = 'current'

export class WorkspaceStateLoadError extends Error {
  constructor(cause: unknown) {
    super('The saved workspace could not be parsed', { cause })
    this.name = 'WorkspaceStateLoadError'
  }
}

async function database() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore('state')
    }
  })
}

export async function loadState(): Promise<PersistedState | undefined> {
  const stored: unknown = await (await database()).get('state', STATE_KEY)
  if (stored === undefined) return undefined
  try {
    return parsePersistedState(stored)
  } catch (error) {
    throw new WorkspaceStateLoadError(error)
  }
}

export async function saveState(state: PersistedState): Promise<void> {
  await (await database()).put('state', state, STATE_KEY)
}

export async function clearState(): Promise<void> {
  await (await database()).delete('state', STATE_KEY)
}
