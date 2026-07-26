import { useCallback, useRef, useState } from 'react'
import { ImportFileError, readImportFile, type ImportFileFailure } from '../lib/importFile'
import { useWorkspace } from '../store/useWorkspace'
import type { FileContent, FileNode } from '../types'

export type ImportTarget = 'list' | 'left' | 'right' | 'fullscreen'
export type ConflictChoice = 'overwrite' | 'copy' | 'skip'

export type ImportItem =
  | { kind: 'file'; file: File; path?: string[]; handle?: FileSystemFileHandle }
  | { kind: 'decoded'; name: string; text: string; mediaBlob?: Blob; dataUrl?: string; mimeType?: string; contentKind?: FileContent['contentKind']; path?: string[]; source?: FileNode['source'] }
  | { kind: 'directory'; path: string[] }

type ConflictDecision = { choice: ConflictChoice; applyAll: boolean }
type ConflictRequest = { name: string; resolve: (decision: ConflictDecision) => void }

function ensureFolders(path: string[]) {
  let parentId: string | null = null
  for (const name of path) {
    const state = useWorkspace.getState()
    const existing = Object.values(state.nodes).find((node) =>
      node.kind === 'directory' && node.parentId === parentId && node.name.toLocaleLowerCase() === name.toLocaleLowerCase()
    )
    parentId = existing?.id ?? state.addDirectory(name, parentId)
  }
  return parentId
}

function openImportedFile(fileId: string, target: Exclude<ImportTarget, 'list'>) {
  const workspace = useWorkspace.getState()
  if (target === 'fullscreen') {
    workspace.openFileFullScreen(fileId)
    return
  }
  if (target === 'left' || target === 'right') {
    workspace.openFileInPane(fileId, target === 'left' ? 'primary' : 'secondary')
    return
  }
  const unsupportedTarget: never = target
  throw new Error(`Unsupported import target: ${unsupportedTarget}`)
}

export function useImportWorkflow() {
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const conflictRef = useRef<ConflictRequest | null>(null)
  const [conflict, setConflict] = useState<ConflictRequest | null>(null)
  const [applyConflictToAll, setApplyConflictToAll] = useState(false)

  const askConflict = useCallback((name: string) => new Promise<ConflictDecision>((resolve) => {
    const request = { name, resolve }
    conflictRef.current = request
    setApplyConflictToAll(false)
    setConflict(request)
  }), [])

  const processItems = useCallback(async (items: ImportItem[], target: ImportTarget) => {
    let firstImportedId: string | null = null
    const failures = new Set<ImportFileFailure>()
    let batchChoice: ConflictChoice | null = null

    for (const item of items) {
      if (item.kind === 'directory') {
        ensureFolders(item.path)
        continue
      }
      let name: string
      let text: string
      let mediaBlob: Blob | undefined
      let dataUrl: string | undefined
      let mimeType: string | undefined
      let contentKind: FileContent['contentKind']
      let handle: FileSystemFileHandle | undefined
      let source: FileNode['source']

      if (item.kind === 'file') {
        let imported
        try {
          imported = await readImportFile(item.file)
        } catch (error) {
          if (!(error instanceof ImportFileError)) throw error
          failures.add(error.code)
          continue
        }
        name = imported.name
        text = imported.text
        mediaBlob = imported.mediaBlob
        mimeType = imported.mimeType
        contentKind = imported.contentKind
        handle = item.handle
        source = handle ? 'picker' : 'drop'
      } else {
        name = item.name
        text = item.text
        mediaBlob = item.mediaBlob
        dataUrl = item.dataUrl
        mimeType = item.mimeType
        contentKind = item.contentKind ?? (item.dataUrl ? 'image' : 'text')
        source = item.source ?? 'drop'
      }

      const parentId = ensureFolders(item.path ?? [])
      const state = useWorkspace.getState()
      const existing = Object.values(state.nodes).find((node) =>
        node.kind === 'file' && node.parentId === parentId && node.name.toLowerCase() === name.toLowerCase()
      )
      let fileId: string

      if (existing) {
        const decision: ConflictDecision = batchChoice
          ? { choice: batchChoice, applyAll: true }
          : await askConflict(name)
        if (decision.applyAll) batchChoice = decision.choice
        if (decision.choice === 'skip') continue
        if (decision.choice === 'overwrite') {
          useWorkspace.getState().replaceImportedFile(existing.id, text, handle, { mediaBlob, dataUrl, mimeType, contentKind })
          fileId = existing.id
        } else {
          fileId = useWorkspace.getState().addFile(name, text, { parentId, source, handle, mediaBlob, dataUrl, mimeType, contentKind, open: false })
        }
      } else {
        fileId = state.addFile(name, text, { parentId, source, handle, mediaBlob, dataUrl, mimeType, contentKind, open: false })
      }
      firstImportedId ??= fileId
    }

    if (target !== 'list' && firstImportedId) openImportedFile(firstImportedId, target)
    if (failures.has('permissionDenied')) useWorkspace.getState().setNotice('permissionDenied')
    else if (failures.has('fileReadFailed')) useWorkspace.getState().setNotice('fileReadFailed')
    else if (failures.has('unsupported')) useWorkspace.getState().setNotice('unsupported')
    return firstImportedId
  }, [askConflict])

  const importItems = useCallback((items: ImportItem[], target: ImportTarget = 'list') => {
    const job = queue.current.then(() => processItems(items, target))
    // Keep later imports serial after a failed job while returning this job's rejection to its caller.
    queue.current = job.then(() => undefined, () => undefined)
    return job
  }, [processItems])

  const finishConflict = useCallback((choice: ConflictChoice) => {
    const request = conflictRef.current
    if (!request) return
    conflictRef.current = null
    setConflict(null)
    request.resolve({ choice, applyAll: applyConflictToAll })
  }, [applyConflictToAll])

  return {
    conflict,
    applyConflictToAll,
    setApplyConflictToAll,
    finishConflict,
    importItems
  }
}
