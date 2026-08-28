import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, FileImage, FileWarning, FolderInput, LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DocumentViewProps } from '../documentFormats/types'
import { useImportWorkflow } from '../hooks/useImportWorkflow'
import { decodeDds, type DdsInfo } from '../lib/dds'
import { contentMediaBlob, downloadBlob } from '../lib/files'
import { ImagePreview } from './ImagePreview'

export default function DdsDocumentView({ content, node, registerController }: DocumentViewProps) {
  const { t } = useTranslation()
  const { importItems } = useImportWorkflow()

  const [phase, setPhase] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [ddsInfo, setDdsInfo] = useState<DdsInfo | null>(null)
  const [pngBlob, setPngBlob] = useState<Blob | null>(null)
  const [pngUrl, setPngUrl] = useState<string>('')
  const [converting, setConverting] = useState(false)
  const generation = useRef(0)

  useEffect(() => {
    registerController(null)
  }, [registerController])

  useEffect(() => {
    let active = true
    generation.current += 1
    const currentGen = generation.current

    setPhase('loading')
    setDdsInfo(null)
    setPngBlob(null)
    setPngUrl('')

    const loadDds = async () => {
      try {
        const rawBlob = contentMediaBlob(content)
        const buffer = await rawBlob.arrayBuffer()
        if (!active || currentGen !== generation.current) return

        const decoded = decodeDds(buffer)
        const blob = await decoded.toPngBlob()
        if (!active || currentGen !== generation.current) return

        const url = URL.createObjectURL(blob)
        setDdsInfo({
          width: decoded.width,
          height: decoded.height,
          format: decoded.format,
          mipmapCount: decoded.mipmapCount,
          hasAlpha: decoded.hasAlpha
        })
        setPngBlob(blob)
        setPngUrl(url)
        setPhase('ready')
      } catch (err) {
        console.error('DDS decoding failed:', err)
        if (active && currentGen === generation.current) {
          setPhase('failed')
        }
      }
    }

    void loadDds()

    return () => {
      active = false
    }
  }, [content])

  useEffect(() => {
    return () => {
      if (pngUrl) URL.revokeObjectURL(pngUrl)
    }
  }, [pngUrl])

  const defaultPngName = node.name.replace(/\.dds$/i, '') + '.png'

  // Download converted PNG
  const handleDownloadPng = useCallback(() => {
    if (!pngBlob) return
    downloadBlob(pngBlob, defaultPngName)
  }, [pngBlob, defaultPngName])

  // Save converted PNG directly to current workspace
  const handleExportToWorkspace = useCallback(async () => {
    if (!pngBlob || converting) return
    setConverting(true)
    try {
      await importItems([
        {
          kind: 'decoded',
          name: defaultPngName,
          text: '',
          mediaBlob: pngBlob,
          mimeType: 'image/png',
          contentKind: 'image',
          source: 'picker'
        }
      ], 'list')
    } finally {
      setConverting(false)
    }
  }, [pngBlob, converting, defaultPngName, importItems])

  if (phase === 'loading') {
    return (
      <div className="document-view-loading dds-loading" role="status">
        <LoaderCircle className="spin" size={32} />
        <span>{t('preparingDdsPreview')}</span>
      </div>
    )
  }

  if (phase === 'failed') {
    return (
      <div className="media-preview-unavailable" role="status">
        <FileWarning size={36} />
        <span>{t('ddsPreviewFailed')}</span>
        <button
          className="secondary-button"
          style={{ marginTop: 16 }}
          onClick={() => {
            try {
              const blob = contentMediaBlob(content)
              downloadBlob(blob, node.name)
            } catch (e) {
              console.error(e)
            }
          }}
        >
          <Download size={16} />
          <span>{t('download')}</span>
        </button>
      </div>
    )
  }

  return (
    <div className="dds-document-view" data-testid="dds-document-view">
      <div className="dds-header-bar">
        <div className="dds-metadata-badges">
          {ddsInfo && (
            <>
              <span className="dds-badge format-badge" title={t('format')}>
                {ddsInfo.format}
              </span>
              <span className="dds-badge dimensions-badge">
                {ddsInfo.width} × {ddsInfo.height}
              </span>
              {ddsInfo.mipmapCount > 1 && (
                <span className="dds-badge mipmaps-badge">
                  {t('mipmaps')}: {ddsInfo.mipmapCount}
                </span>
              )}
            </>
          )}
        </div>

        <div className="dds-actions">
          <button
            className="dds-btn secondary"
            onClick={() => void handleExportToWorkspace()}
            disabled={converting}
            title={t('exportPngToWorkspace')}
          >
            <FolderInput size={15} />
            <span>{t('exportPngToWorkspace')}</span>
          </button>
          <button
            className="dds-btn primary"
            onClick={handleDownloadPng}
            title={t('downloadPng')}
          >
            <Download size={15} />
            <span>{t('downloadPng')}</span>
          </button>
        </div>
      </div>

      <div className="dds-preview-stage">
        {pngUrl && <ImagePreview src={pngUrl} name={node.name} />}
      </div>
    </div>
  )
}
