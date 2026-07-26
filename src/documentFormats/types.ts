import type { ComponentType, LazyExoticComponent } from 'react'
import type { FileContent, FileNode } from '../types'

export interface DocumentMatchInput {
  name: string
  mimeType?: string
  contentKind?: FileContent['contentKind']
}

export interface DocumentFormat {
  id: string
  dataKind: NonNullable<FileContent['contentKind']>
  label: (input: DocumentMatchInput) => string
  matches: (input: DocumentMatchInput) => boolean
}

export interface DocumentViewProps {
  fileId: string
  node: FileNode
  content: FileContent
  updateText: (value: string) => void
  registerController: (controller: DocumentViewController | null) => void
}

export interface DocumentViewController {
  find?: () => void
  redo?: () => void
  undo?: () => void
}

export interface DocumentCapabilities {
  find: boolean
  history: boolean
  textEditing: boolean
  textZoom: boolean
}

export interface DocumentViewProvider {
  id: string
  labelKey: string
  priority: number
  component: LazyExoticComponent<ComponentType<DocumentViewProps>>
  capabilities: DocumentCapabilities
  matches: (format: DocumentFormat, input: DocumentMatchInput) => boolean
}
