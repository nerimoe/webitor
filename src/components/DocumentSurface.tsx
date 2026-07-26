import { Suspense } from 'react'
import type { DocumentViewController } from '../documentFormats/types'
import type { DocumentViewProvider } from '../documentFormats/types'
import type { FileContent, FileNode } from '../types'

export function DocumentSurface({ view, fileId, node, content, updateText, registerController }: {
  view: DocumentViewProvider
  fileId: string
  node: FileNode
  content: FileContent
  updateText: (value: string) => void
  registerController: (controller: DocumentViewController | null) => void
}) {
  const View = view.component
  return <Suspense fallback={<div className="document-view-loading" role="status" />}>
    <View fileId={fileId} node={node} content={content} updateText={updateText} registerController={registerController} />
  </Suspense>
}
