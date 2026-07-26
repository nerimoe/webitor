import { lazy } from 'react'
import type { DocumentFormat, DocumentMatchInput, DocumentViewProvider } from './types'

const noTextCapabilities = { find: false, history: false, textEditing: false, textZoom: false } as const
const textCapabilities = { find: true, history: true, textEditing: true, textZoom: true } as const

const HeicDocumentView = lazy(() => import('../components/HeicDocumentView'))
const ImageDocumentView = lazy(() => import('../components/MediaPreview').then((module) => ({ default: module.ImageDocumentView })))
const VideoDocumentView = lazy(() => import('../components/MediaPreview').then((module) => ({ default: module.VideoDocumentView })))
const TextDocumentView = lazy(() => import('../components/TextDocumentView'))
const MarkdownDocumentView = lazy(() => import('../components/MarkdownDocumentView'))
const UnsupportedDocumentView = lazy(() => import('../components/UnsupportedDocumentView'))

const extension = (name: string) => name.split('.').at(-1)?.toLowerCase() ?? ''
const mediaLabel = (input: DocumentMatchInput) => input.mimeType?.split('/').at(-1)?.toUpperCase() ?? 'Media'

const builtInFormats: DocumentFormat[] = [
  {
    id: 'heic', dataKind: 'image', label: () => 'HEIC',
    matches: ({ name, mimeType }) => /^(image\/hei[cf](?:-sequence)?)$/i.test(mimeType ?? '') || /^(heic|heif|heics|heifs)$/i.test(extension(name))
  },
  {
    id: 'image', dataKind: 'image', label: mediaLabel,
    matches: ({ name, mimeType, contentKind }) => contentKind === 'image' || mimeType?.toLowerCase().startsWith('image/') === true || /^(apng|avif|bmp|gif|ico|jfif|jpe?g|jxl|png|svg|tif{1,2}|webp)$/i.test(extension(name))
  },
  {
    id: 'video', dataKind: 'video', label: mediaLabel,
    matches: ({ name, mimeType, contentKind }) => contentKind === 'video' || mimeType?.toLowerCase().startsWith('video/') === true || /^(3g2|3gp|avi|flv|m2ts|m4v|mkv|mov|mp4|mpeg|mpg|mts|ogv|ts|vob|webm|wmv)$/i.test(extension(name))
  },
  {
    id: 'markdown', dataKind: 'text', label: () => 'Markdown',
    matches: ({ name, contentKind }) => (contentKind === undefined || contentKind === 'text') && /\.(md|markdown|mdown|mkd)$/i.test(name)
  },
  {
    id: 'binary', dataKind: 'binary', label: mediaLabel,
    matches: ({ contentKind }) => contentKind === 'binary'
  },
  {
    id: 'text', dataKind: 'text', label: () => 'Plain text',
    matches: ({ contentKind }) => contentKind === undefined || contentKind === 'text'
  }
]

const builtInViews: DocumentViewProvider[] = [
  { id: 'text-editor', labelKey: 'textEditorView', priority: 100, component: TextDocumentView, capabilities: textCapabilities, matches: (format) => format.dataKind === 'text' },
  { id: 'markdown-preview', labelKey: 'markdownPreviewView', priority: 50, component: MarkdownDocumentView, capabilities: noTextCapabilities, matches: (format) => format.id === 'markdown' },
  { id: 'heic-view', labelKey: 'heicView', priority: 100, component: HeicDocumentView, capabilities: noTextCapabilities, matches: (format) => format.id === 'heic' },
  { id: 'image-view', labelKey: 'imageView', priority: 100, component: ImageDocumentView, capabilities: noTextCapabilities, matches: (format) => format.id === 'image' },
  { id: 'video-view', labelKey: 'videoView', priority: 100, component: VideoDocumentView, capabilities: noTextCapabilities, matches: (format) => format.id === 'video' },
  { id: 'binary-view', labelKey: 'binaryView', priority: 100, component: UnsupportedDocumentView, capabilities: noTextCapabilities, matches: (format) => format.id === 'binary' }
]

const customFormats: DocumentFormat[] = []
const customViews: DocumentViewProvider[] = []

function registerUnique<T extends { id: string }>(entry: T, custom: T[], builtIn: T[], kind: string) {
  if (!entry.id.trim()) throw new Error(`${kind} id is required`)
  if ([...custom, ...builtIn].some((candidate) => candidate.id === entry.id)) throw new Error(`${kind} already registered: ${entry.id}`)
  custom.unshift(entry)
  return () => {
    const index = custom.indexOf(entry)
    if (index >= 0) custom.splice(index, 1)
  }
}

export function registerDocumentFormat(format: DocumentFormat) {
  return registerUnique(format, customFormats, builtInFormats, 'Document format')
}

export function registerDocumentView(view: DocumentViewProvider) {
  if (!Number.isFinite(view.priority)) throw new Error(`Document view priority must be finite: ${view.id}`)
  return registerUnique(view, customViews, builtInViews, 'Document view')
}

export function resolveDocumentFormat(input: DocumentMatchInput) {
  const format = [...customFormats, ...builtInFormats].find((entry) => entry.matches(input))
  if (!format) throw new Error(`No document format matched ${input.name}`)
  return format
}

export function resolveImportFormat(input: Omit<DocumentMatchInput, 'contentKind'>) {
  return [...customFormats, ...builtInFormats.slice(0, -1)].find((entry) => entry.matches(input))
}

export function resolveDocumentViews(input: DocumentMatchInput) {
  const format = resolveDocumentFormat(input)
  const views = [...customViews, ...builtInViews]
    .filter((view) => view.matches(format, input))
    .sort((left, right) => right.priority - left.priority)
  if (!views.length) throw new Error(`No document view matched ${input.name}`)
  return { format, views }
}

export function defaultDocumentViewId(input: DocumentMatchInput) {
  return resolveDocumentViews(input).views[0].id
}
