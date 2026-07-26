import { resolveImportFormat } from '../documentFormats/registry'
import type { FileContent } from '../types'
import { isProbablyText, mediaMimeType } from './files'

export type ImportFileFailure = 'unsupported' | 'fileReadFailed' | 'permissionDenied'

export class ImportFileError extends Error {
  constructor(readonly code: ImportFileFailure, readonly source: unknown) {
    super(code)
    this.name = 'ImportFileError'
  }
}

export interface ImportedFileData {
  name: string
  text: string
  mediaBlob?: Blob
  mimeType?: string
  contentKind: NonNullable<FileContent['contentKind']>
}

function readFailure(error: unknown): ImportFileFailure {
  if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) return 'permissionDenied'
  return 'fileReadFailed'
}

export async function readImportFile(file: File): Promise<ImportedFileData> {
  const provider = resolveImportFormat({ name: file.name, mimeType: file.type })
  const dataKind = provider?.dataKind ?? (isProbablyText(file) ? 'text' : null)
  if (!dataKind) throw new ImportFileError('unsupported', file.type)
  try {
    const binary = dataKind !== 'text'
    const mimeType = dataKind === 'image' || dataKind === 'video'
      ? mediaMimeType(file, dataKind)
      : binary ? file.type || 'application/octet-stream' : undefined
    return {
      name: file.name,
      text: binary ? '' : await file.text(),
      contentKind: dataKind,
      ...(binary ? { mediaBlob: file.type === mimeType ? file : new Blob([file], { type: mimeType }), mimeType } : {})
    }
  } catch (error) {
    throw new ImportFileError(readFailure(error), error)
  }
}
