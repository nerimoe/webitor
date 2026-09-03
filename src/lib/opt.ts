import type { OptRawFileEntry, OptWorkerRequestPayload, OptWorkerResponse } from '../workers/optDecoder.worker'
import { formatBytes, getFileExtension, inferEntryKind, inferMimeType } from './zip'

export type { OptRawFileEntry }

export interface OptEntry {
  id?: number
  path: string
  name: string
  dir: boolean
  size: number
  depth: number
}

interface PendingRequest {
  resolve: (value: any) => void
  reject: (reason?: any) => void
}

export class OptArchiveClient {
  private worker: Worker
  private nextId = 1
  private pending = new Map<number, PendingRequest>()

  constructor(worker: Worker) {
    this.worker = worker
    this.worker.onmessage = (event: MessageEvent<OptWorkerResponse>) => {
      const msg = event.data
      const request = this.pending.get(msg.id)
      if (!request) return
      this.pending.delete(msg.id)
      if (msg.type === 'error') {
        request.reject(new Error(msg.error))
      } else {
        request.resolve(msg)
      }
    }
    this.worker.onerror = (error) => {
      for (const req of this.pending.values()) {
        req.reject(new Error(error.message || 'Worker error'))
      }
      this.pending.clear()
    }
  }

  private send<T>(req: OptWorkerRequestPayload, transfer: Transferable[] = []): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ ...req, id }, transfer)
    })
  }

  async open(buffer: ArrayBuffer): Promise<OptRawFileEntry[]> {
    const res = await this.send<{ type: 'open'; entries: OptRawFileEntry[] }>({ type: 'open', buffer }, [buffer])
    return res.entries
  }

  async readFile(fileId: number): Promise<Uint8Array> {
    const res = await this.send<{ type: 'read'; fileId: number; buffer: ArrayBuffer }>({ type: 'read', fileId })
    return new Uint8Array(res.buffer)
  }

  async readMultiple(fileIds: number[]): Promise<Map<number, Uint8Array>> {
    const res = await this.send<{ type: 'readMultiple'; files: Array<{ fileId: number; buffer: ArrayBuffer }> }>({
      type: 'readMultiple',
      fileIds
    })
    const map = new Map<number, Uint8Array>()
    for (const file of res.files) {
      map.set(file.fileId, new Uint8Array(file.buffer))
    }
    return map
  }

  async createZip(): Promise<Uint8Array> {
    const res = await this.send<{ type: 'zip'; buffer: ArrayBuffer }>({ type: 'zip' })
    return new Uint8Array(res.buffer)
  }

  close(): void {
    void this.send({ type: 'close' }).catch(() => {})
  }

  terminate(): void {
    this.worker.terminate()
    this.pending.clear()
  }
}

export function buildOptTree(rawFiles: OptRawFileEntry[]): OptEntry[] {
  type TreeNode = {
    path: string
    name: string
    isDir: boolean
    id?: number
    size: number
    children: Map<string, TreeNode>
  }

  const root: TreeNode = {
    path: '',
    name: '',
    isDir: true,
    size: 0,
    children: new Map()
  }

  for (const raw of rawFiles) {
    const normalized = raw.path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    if (!normalized) continue
    const parts = normalized.split('/')
    let current = root
    let currentPath = ''

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      currentPath = currentPath ? `${currentPath}/${part}` : part
      const isLeaf = i === parts.length - 1

      if (isLeaf) {
        const size = Number(raw.sizeBytes) || 0
        current.children.set(part, {
          path: currentPath,
          name: part,
          isDir: false,
          id: raw.id,
          size,
          children: new Map()
        })
      } else {
        let dirNode = current.children.get(part)
        if (!dirNode) {
          dirNode = {
            path: currentPath,
            name: part,
            isDir: true,
            size: 0,
            children: new Map()
          }
          current.children.set(part, dirNode)
        }
        current = dirNode
      }
    }
  }

  function computeDirSizes(node: TreeNode): number {
    if (!node.isDir) return node.size
    let sum = 0
    for (const child of node.children.values()) {
      sum += computeDirSizes(child)
    }
    node.size = sum
    return sum
  }
  computeDirSizes(root)

  const result: OptEntry[] = []

  function traverse(node: TreeNode, depth: number) {
    const sorted = [...node.children.values()].sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    })

    for (const child of sorted) {
      result.push({
        id: child.id,
        path: child.path,
        name: child.name,
        dir: child.isDir,
        size: child.size,
        depth
      })
      if (child.isDir) {
        traverse(child, depth + 1)
      }
    }
  }

  traverse(root, 0)
  return result
}

export { formatBytes, getFileExtension, inferEntryKind, inferMimeType }
