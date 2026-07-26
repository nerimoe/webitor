import { useCallback, useEffect, useRef, useState } from 'react'
import { FileWarning, LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DocumentViewProps } from '../documentFormats/types'
import { contentMediaBlob } from '../lib/files'
import { ImagePreview } from './ImagePreview'

interface DecodedFrame {
  blob: Blob
  height: number
  width: number
}

type DecodeResponse = { frames: DecodedFrame[] } | { error: string }

export default function HeicDocumentView({ content, node, registerController }: DocumentViewProps) {
  const { t } = useTranslation()
  const [nativeSrc, setNativeSrc] = useState('')
  const [decodedSources, setDecodedSources] = useState<string[]>([])
  const [selected, setSelected] = useState(0)
  const [phase, setPhase] = useState<'native' | 'decoding' | 'decoded' | 'failed'>('native')
  const workerRef = useRef<Worker | null>(null)
  const generation = useRef(0)

  useEffect(() => { registerController(null) }, [registerController])

  useEffect(() => {
    const blob = contentMediaBlob(content)
    const url = URL.createObjectURL(blob)
    generation.current += 1
    workerRef.current?.terminate()
    workerRef.current = null
    setNativeSrc(url)
    setDecodedSources([])
    setSelected(0)
    setPhase('native')
    return () => {
      URL.revokeObjectURL(url)
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [content.dataUrl, content.mediaBlob, content.mimeType])

  useEffect(() => () => decodedSources.forEach((url) => URL.revokeObjectURL(url)), [decodedSources])

  const decode = useCallback(async () => {
    if (phase !== 'native') return
    const currentGeneration = generation.current
    setPhase('decoding')
    try {
      const buffer = await contentMediaBlob(content).arrayBuffer()
      if (currentGeneration !== generation.current) return
      const worker = new Worker(new URL('../workers/heifDecoder.worker.ts', import.meta.url), { type: 'module' })
      workerRef.current = worker
      const response = await new Promise<DecodeResponse>((resolve, reject) => {
        worker.onmessage = (event: MessageEvent<DecodeResponse>) => resolve(event.data)
        worker.onerror = () => reject(new Error('HEIF decoder worker failed'))
        worker.postMessage({ buffer }, [buffer])
      })
      worker.terminate()
      if (workerRef.current === worker) workerRef.current = null
      if (currentGeneration !== generation.current) return
      if ('error' in response) throw new Error(response.error)
      const sources = response.frames.map((frame) => URL.createObjectURL(frame.blob))
      if (!sources.length) throw new Error('HEIF decoder returned no images')
      setDecodedSources(sources)
      setSelected(0)
      setPhase('decoded')
    } catch (error) {
      console.error('HEIC preview decoding failed', error)
      if (currentGeneration === generation.current) setPhase('failed')
    }
  }, [content, phase])

  if (phase === 'decoding') return <div className="document-view-loading heic-loading" role="status"><LoaderCircle className="spin" size={32} /><span>{t('preparingHeicPreview')}</span></div>
  if (phase === 'failed') return <div className="media-preview-unavailable" role="status"><FileWarning size={36} /><span>{t('heicPreviewFailed')}</span></div>
  if (phase === 'decoded') return <div className="heic-document-view" data-testid="heic-decoded-preview">
    {decodedSources.length > 1 && <div className="heic-frame-list" aria-label={t('heicImages')}>
      {decodedSources.map((source, index) => <button key={source} className={selected === index ? 'active' : ''} onClick={() => setSelected(index)} aria-label={t('heicImageNumber', { number: index + 1 })}><img src={source} alt="" /></button>)}
    </div>}
    <ImagePreview src={decodedSources[selected]} name={node.name} />
  </div>
  if (!nativeSrc) return null
  return <ImagePreview src={nativeSrc} name={node.name} onError={() => void decode()} />
}
