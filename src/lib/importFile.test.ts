import { describe, expect, it, vi } from 'vitest'
import { ImportFileError, readImportFile, readImportHandle } from './importFile'

describe('file import boundary', () => {
  it('classifies unsupported binary files separately', async () => {
    const file = new File(['binary'], 'archive.zip', { type: 'application/zip' })
    await expect(readImportFile(file)).rejects.toMatchObject({ code: 'unsupported' } satisfies Partial<ImportFileError>)
  })

  it('reports file read failures instead of calling them binary', async () => {
    const file = new File(['text'], 'note.txt', { type: 'text/plain' })
    vi.spyOn(file, 'text').mockRejectedValue(new DOMException('unreadable', 'NotReadableError'))
    await expect(readImportFile(file)).rejects.toMatchObject({ code: 'fileReadFailed' } satisfies Partial<ImportFileError>)
  })

  it('reports permission denial separately', async () => {
    const file = new File(['text'], 'note.txt', { type: 'text/plain' })
    vi.spyOn(file, 'text').mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
    await expect(readImportFile(file)).rejects.toMatchObject({ code: 'permissionDenied' } satisfies Partial<ImportFileError>)
  })

  it('maps file-system handle permission failures to the same import contract', async () => {
    const denied = new DOMException('denied', 'NotAllowedError')
    const handle = { getFile: vi.fn().mockRejectedValue(denied) } as unknown as FileSystemFileHandle

    await expect(readImportHandle(handle)).rejects.toMatchObject({ code: 'permissionDenied', source: denied } satisfies Partial<ImportFileError>)
  })

  it.each([
    ['photo.heic', '', 'image', 'image/heic'],
    ['photo.heif', 'image/heif', 'image', 'image/heif'],
    ['clip.mov', '', 'video', 'video/quicktime'],
    ['clip.webm', 'video/webm', 'video', 'video/webm']
  ] as const)('imports %s as binary %s content', async (name, type, contentKind, mimeType) => {
    const file = new File([new Uint8Array([0, 1, 2, 3])], name, { type })
    const imported = await readImportFile(file)
    expect(imported).toMatchObject({ name, contentKind, mimeType, text: '' })
    expect(imported.mediaBlob?.type).toBe(mimeType)
    expect(new Uint8Array(await imported.mediaBlob!.arrayBuffer())).toEqual(new Uint8Array([0, 1, 2, 3]))
  })
})
