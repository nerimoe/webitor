/// <reference lib="webworker" />

import init, { open_opt, type ArchiveHandle } from './opt/fsdecrypt_web_core.js'

export type OptRawFileEntry = {
  id: number
  path: string
  sizeBytes: string
}

export type OptWorkerRequestPayload =
  | { type: 'open'; buffer: ArrayBuffer }
  | { type: 'read'; fileId: number }
  | { type: 'readMultiple'; fileIds: number[] }
  | { type: 'zip' }
  | { type: 'close' }

export type OptWorkerRequest = OptWorkerRequestPayload & { id: number }

export type OptWorkerResponse =
  | { id: number; type: 'open'; entries: OptRawFileEntry[] }
  | { id: number; type: 'read'; fileId: number; buffer: ArrayBuffer }
  | { id: number; type: 'readMultiple'; files: Array<{ fileId: number; buffer: ArrayBuffer }> }
  | { id: number; type: 'zip'; buffer: ArrayBuffer }
  | { id: number; type: 'close' }
  | { id: number; type: 'error'; error: string }

let archive: ArchiveHandle | null = null
let initialized = false

self.onmessage = async (event: MessageEvent<OptWorkerRequest>) => {
  const msg = event.data
  try {
    if (!initialized) {
      await init()
      initialized = true
    }

    if (msg.type === 'open') {
      archive?.free()
      archive = null
      archive = open_opt(new Uint8Array(msg.buffer))
      const entries = archive.list_files() as OptRawFileEntry[]
      self.postMessage({ id: msg.id, type: 'open', entries })
      return
    }

    if (msg.type === 'close') {
      archive?.free()
      archive = null
      self.postMessage({ id: msg.id, type: 'close' })
      return
    }

    if (!archive) {
      throw new Error('No .opt container is currently open')
    }

    if (msg.type === 'read') {
      const bytes = archive.read_file(msg.fileId).slice()
      self.postMessage({ id: msg.id, type: 'read', fileId: msg.fileId, buffer: bytes.buffer }, [bytes.buffer])
      return
    }

    if (msg.type === 'readMultiple') {
      const files: Array<{ fileId: number; buffer: ArrayBuffer }> = []
      const transferList: Transferable[] = []
      for (const fileId of msg.fileIds) {
        const bytes = archive.read_file(fileId).slice()
        files.push({ fileId, buffer: bytes.buffer })
        transferList.push(bytes.buffer)
      }
      self.postMessage({ id: msg.id, type: 'readMultiple', files }, transferList)
      return
    }

    if (msg.type === 'zip') {
      const bytes = archive.create_store_zip().slice()
      self.postMessage({ id: msg.id, type: 'zip', buffer: bytes.buffer }, [bytes.buffer])
      return
    }
  } catch (error) {
    self.postMessage({
      id: msg.id,
      type: 'error',
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

export {}
