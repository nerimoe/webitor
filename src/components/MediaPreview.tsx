import { useEffect, useState } from 'react'
import { FileWarning } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { contentMediaBlob } from '../lib/files'
import type { FileContent } from '../types'
import { ImagePreview } from './ImagePreview'
import type { DocumentViewProps } from '../documentFormats/types'

export function MediaPreview({ content, name }: { content: FileContent; name: string }) {
  const { t } = useTranslation()
  const [failed, setFailed] = useState(false)
  const [src, setSrc] = useState('')

  useEffect(() => {
    const url = URL.createObjectURL(contentMediaBlob(content))
    setSrc(url)
    setFailed(false)
    return () => URL.revokeObjectURL(url)
  }, [content.dataUrl, content.mediaBlob, content.mimeType])

  if (failed) return <div className="media-preview-unavailable" role="status"><FileWarning size={36} /><span>{t('mediaPreviewUnavailable')}</span></div>
  if (!src) return null
  if (content.contentKind === 'video') {
    return <div className="video-preview" data-testid="video-preview"><video src={src} controls playsInline preload="metadata" onError={() => setFailed(true)} aria-label={name} /></div>
  }
  return <ImagePreview src={src} name={name} onError={() => setFailed(true)} />
}

export function ImageDocumentView({ content, node, registerController }: DocumentViewProps) {
  useEffect(() => { registerController(null) }, [registerController])
  return <MediaPreview content={content} name={node.name} />
}

export function VideoDocumentView({ content, node, registerController }: DocumentViewProps) {
  useEffect(() => { registerController(null) }, [registerController])
  return <MediaPreview content={content} name={node.name} />
}
