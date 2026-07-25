import { openDB } from 'idb'
import type { PersistedState } from '../types'

// Keep the legacy key so upgrading to Webitor does not orphan existing documents.
const DB_NAME = 'local-ide'
const STATE_KEY = 'current'

async function database() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore('state')
    }
  })
}

export async function loadState(): Promise<PersistedState | undefined> {
  return (await database()).get('state', STATE_KEY)
}

export async function saveState(state: PersistedState): Promise<void> {
  await (await database()).put('state', state, STATE_KEY)
}

export async function clearState(): Promise<void> {
  await (await database()).delete('state', STATE_KEY)
}
