import { describe, expect, it, vi } from 'vitest'
import { buildOptTree, OptArchiveClient, type OptRawFileEntry } from './opt'

describe('opt library', () => {
  describe('buildOptTree', () => {
    it('creates hierarchical directory and file entries from raw files', () => {
      const raw: OptRawFileEntry[] = [
        { id: 0, path: 'data.conf', sizeBytes: '323' },
        { id: 1, path: 'event/event00019200/Event.xml', sizeBytes: '3797' },
        { id: 2, path: 'event/event00019200/readme.txt', sizeBytes: '100' }
      ]

      const tree = buildOptTree(raw)

      // Expected:
      // event (dir, depth 0, size 3897)
      // event/event00019200 (dir, depth 1, size 3897)
      // event/event00019200/Event.xml (file, depth 2, size 3797, id 1)
      // event/event00019200/readme.txt (file, depth 2, size 100, id 2)
      // data.conf (file, depth 0, size 323, id 0)
      expect(tree.map((e) => ({ path: e.path, dir: e.dir, depth: e.depth, size: e.size, id: e.id }))).toEqual([
        { path: 'event', dir: true, depth: 0, size: 3897, id: undefined },
        { path: 'event/event00019200', dir: true, depth: 1, size: 3897, id: undefined },
        { path: 'event/event00019200/Event.xml', dir: false, depth: 2, size: 3797, id: 1 },
        { path: 'event/event00019200/readme.txt', dir: false, depth: 2, size: 100, id: 2 },
        { path: 'data.conf', dir: false, depth: 0, size: 323, id: 0 }
      ])
    })

    it('handles root-level files and normalizes path slashes', () => {
      const raw: OptRawFileEntry[] = [
        { id: 10, path: '/a\\b\\c.png', sizeBytes: '500' }
      ]

      const tree = buildOptTree(raw)
      expect(tree).toHaveLength(3)
      expect(tree[0]).toMatchObject({ path: 'a', dir: true, depth: 0 })
      expect(tree[1]).toMatchObject({ path: 'a/b', dir: true, depth: 1 })
      expect(tree[2]).toMatchObject({ path: 'a/b/c.png', dir: false, depth: 2, id: 10, size: 500 })
    })

    it('returns empty array when given no files', () => {
      expect(buildOptTree([])).toEqual([])
    })
  })

  describe('OptArchiveClient', () => {
    type MockWorkerType = {
      postMessage: ReturnType<typeof vi.fn>
      terminate: ReturnType<typeof vi.fn>
      onmessage: ((event: { data: any }) => void) | null
      onerror: ((error: any) => void) | null
    }

    const createMockWorker = (): MockWorkerType => ({
      postMessage: vi.fn(),
      terminate: vi.fn(),
      onmessage: null,
      onerror: null
    })

    it('sends open request and receives file list', async () => {
      const mockWorker = createMockWorker()
      const client = new OptArchiveClient(mockWorker as unknown as Worker)

      const openPromise = client.open(new ArrayBuffer(16))
      expect(mockWorker.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, type: 'open' }),
        expect.any(Array)
      )

      mockWorker.onmessage!({
        data: {
          id: 1,
          type: 'open',
          entries: [{ id: 0, path: 'test.txt', sizeBytes: '10' }]
        }
      })

      const entries = await openPromise
      expect(entries).toEqual([{ id: 0, path: 'test.txt', sizeBytes: '10' }])
    })

    it('reads single file bytes', async () => {
      const mockWorker = createMockWorker()
      const client = new OptArchiveClient(mockWorker as unknown as Worker)
      const readPromise = client.readFile(42)

      expect(mockWorker.postMessage).toHaveBeenCalledWith(
        { id: 1, type: 'read', fileId: 42 },
        []
      )

      const buffer = new Uint8Array([1, 2, 3]).buffer
      mockWorker.onmessage!({
        data: { id: 1, type: 'read', fileId: 42, buffer }
      })

      const result = await readPromise
      expect(result).toEqual(new Uint8Array([1, 2, 3]))
    })

    it('reads multiple files in batch', async () => {
      const mockWorker = createMockWorker()
      const client = new OptArchiveClient(mockWorker as unknown as Worker)
      const batchPromise = client.readMultiple([1, 2])

      expect(mockWorker.postMessage).toHaveBeenCalledWith(
        { id: 1, type: 'readMultiple', fileIds: [1, 2] },
        []
      )

      mockWorker.onmessage!({
        data: {
          id: 1,
          type: 'readMultiple',
          files: [
            { fileId: 1, buffer: new Uint8Array([10]).buffer },
            { fileId: 2, buffer: new Uint8Array([20]).buffer }
          ]
        }
      })

      const map = await batchPromise
      expect(map.get(1)).toEqual(new Uint8Array([10]))
      expect(map.get(2)).toEqual(new Uint8Array([20]))
    })

    it('creates store zip from archive', async () => {
      const mockWorker = createMockWorker()
      const client = new OptArchiveClient(mockWorker as unknown as Worker)
      const zipPromise = client.createZip()

      expect(mockWorker.postMessage).toHaveBeenCalledWith(
        { id: 1, type: 'zip' },
        []
      )

      const zipBuf = new Uint8Array([80, 75, 5, 6]).buffer
      mockWorker.onmessage!({
        data: { id: 1, type: 'zip', buffer: zipBuf }
      })

      const res = await zipPromise
      expect(res).toEqual(new Uint8Array([80, 75, 5, 6]))
    })

    it('propagates worker errors', async () => {
      const mockWorker = createMockWorker()
      const client = new OptArchiveClient(mockWorker as unknown as Worker)
      const promise = client.readFile(99)

      mockWorker.onmessage!({
        data: { id: 1, type: 'error', error: 'Decryption error' }
      })

      await expect(promise).rejects.toThrow('Decryption error')
    })
  })

  describe('WASM core integration with fixtures', () => {
    it('initializes WASM core and decrypts fixture file', async () => {
      const nodeFs = 'node:fs'
      const nodePath = 'node:path'
      // @ts-ignore
      const fs = (await import(/* @vite-ignore */ nodeFs)) as any
      // @ts-ignore
      const path = (await import(/* @vite-ignore */ nodePath)) as any
      const initModule = await import('../workers/opt/fsdecrypt_web_core.js')

      const root = (globalThis as any).process?.cwd?.() || '.'
      const wasmPath = path.resolve(root, 'src/workers/opt/fsdecrypt_web_core_bg.wasm')
      const wasmBytes = fs.readFileSync(wasmPath)
      await initModule.default({ module_or_path: wasmBytes })

      const fixturePath = path.resolve(root, '../fsdecrypt-web/fixtures/TEST_T001_20240101120000_0.opt')
      if (fs.existsSync(fixturePath)) {
        const fixtureBytes = fs.readFileSync(fixturePath)
        const archive = initModule.open_opt(new Uint8Array(fixtureBytes))
        const files = archive.list_files() as Array<{ id: number; path: string; sizeBytes: string }>
        expect(files.length).toBeGreaterThan(0)

        // Read first file
        const firstFileBytes = archive.read_file(files[0].id)
        expect(firstFileBytes.byteLength).toBe(Number(files[0].sizeBytes))

        // Create store zip
        const zipBytes = archive.create_store_zip()
        expect(zipBytes.byteLength).toBeGreaterThan(0)
        // Check ZIP magic PK\x03\x04
        expect(zipBytes[0]).toBe(0x50)
        expect(zipBytes[1]).toBe(0x4b)

        archive.free()
      }
    })
  })
})
