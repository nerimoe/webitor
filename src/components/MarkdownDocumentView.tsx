import { useEffect } from 'react'
import type { DocumentViewProps } from '../documentFormats/types'
import { MarkdownPreview } from './MarkdownPreview'

export default function MarkdownDocumentView({ content, registerController }: DocumentViewProps) {
  useEffect(() => { registerController(null) }, [registerController])
  return <div className="markdown-document-view" data-testid="markdown-preview"><MarkdownPreview value={content.text} /></div>
}
