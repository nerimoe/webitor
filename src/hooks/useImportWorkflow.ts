import { useCallback, useRef, useState } from 'react'
import { fileToDataUrl, isProbablyText, isSupportedImage } from '../lib/files'
import { useWorkspace } from '../store/useWorkspace'
import type { FileNode } from '../types'

export type ImportTarget = false | 'active' | 'primary' | 'secondary' | 'single'
export type ConflictChoice = 'overwrite' | 'copy' | 'skip'

export type ImportItem =
  | { kind: 'file'; file: File; path?: string[]; handle?: FileSystemFileHandle }
  | { kind: 'decoded'; name: string; text: string; dataUrl?: string; mimeType?: string; path?: string[]; source?: FileNode['source'] }
  | { kind: 'directory'; path: string[] }

type ConflictDecision = { choice: ConflictChoice; applyAll: boolean }
type ConflictRequest = { name: string; resolve: (decision: ConflictDecision) => void }

function ensureFolders(path: string[]) {
  let parentId: string | null = null
  for (const name of path) {
    const state = useWorkspace.getState()
    const existing = Object.values(state.nodes).find((node) =>
      node.kind === 'directory' && node.parentId === parentId && node.name === name
    )
    parentId = existing?.id ?? state.addDirectory(name, parentId)
  }
  return parentId
}

function openImportedFile(fileId: string, target: Exclude<ImportTarget, false>) {
  const workspace = useWorkspace.getState()
  if (target === 'single') {
    workspace.closeSecondary()
    useWorkspace.getState().openFile(fileId, 'primary')
    return
  }
  if (target === 'primary') {
    const groups = workspace.layout.groups
    if (!groups[1].activeFileId && groups[0].activeFileId && groups[0].activeFileId !== fileId) {
      workspace.openFile(groups[0].activeFileId, 'secondary')
    }
    useWorkspace.getState().openFile(fileId, 'primary')
    return
  }
  workspace.openFile(fileId, target === 'secondary' ? 'secondary' : workspace.layout.activeMobileGroup)
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
    let rejected = false
    let batchChoice: ConflictChoice | null = null

    for (const item of items) {
      try {
        if (item.kind === 'directory') {
          ensureFolders(item.path)
          continue
        }
        let name: string
        let text: string
        let dataUrl: string | undefined
        let mimeType: string | undefined
        let handle: FileSystemFileHandle | undefined
        let source: FileNode['source']

        if (item.kind === 'file') {
          const image = isSupportedImage(item.file)
          if (!image && !isProbablyText(item.file)) {
            rejected = true
            continue
          }
          name = item.file.name
          text = image ? '' : await item.file.text()
          dataUrl = image ? await fileToDataUrl(item.file) : undefined
          mimeType = image ? item.file.type : undefined
          handle = item.handle
          source = handle ? 'picker' : 'drop'
        } else {
          name = item.name
          text = item.text
          dataUrl = item.dataUrl
          mimeType = item.mimeType
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
            useWorkspace.getState().replaceImportedFile(existing.id, text, handle, { dataUrl, mimeType })
            fileId = existing.id
          } else {
            fileId = useWorkspace.getState().addFile(name, text, { parentId, source, handle, dataUrl, mimeType, open: false })
          }
        } else {
          fileId = state.addFile(name, text, { parentId, source, handle, dataUrl, mimeType, open: false })
        }
        firstImportedId ??= fileId
      } catch {
        rejected = true
      }
    }

    if (target && firstImportedId) openImportedFile(firstImportedId, target)
    if (rejected) useWorkspace.getState().setNotice('unsupported')
    return firstImportedId
  }, [askConflict])

  const importItems = useCallback((items: ImportItem[], target: ImportTarget = false) => {
    const job = queue.current.catch(() => undefined).then(() => processItems(items, target))
    queue.current = job
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
