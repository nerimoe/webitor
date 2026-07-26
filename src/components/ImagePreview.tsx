import { useLayoutEffect, useRef, useState } from 'react'
import { Maximize2, Minus, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from './IconButton'
import { useLocalZoom, type ZoomAnchor } from './useLocalZoom'

export function ImagePreview({ src, name, onError }: { src: string; name: string; onError?: () => void }) {
  const { t } = useTranslation()
  const [zoom, setZoom] = useState(100)
  const imageRef = useRef<HTMLImageElement>(null)
  const pendingAnchor = useRef<{ clientX: number; clientY: number; imageX: number; imageY: number } | null>(null)
  const pinch = useRef<{ imageX: number; imageY: number; baseZoom: number; rect: DOMRect } | null>(null)
  const { ref: stageRef, elementRef: stageElementRef } = useLocalZoom<HTMLDivElement>(zoom, setZoom, {
    min: 25,
    max: 400,
    step: 10,
    onZoomAt: (nextZoom, anchor: ZoomAnchor) => {
      const stage = stageElementRef.current
      const image = imageRef.current
      if (!stage || !image) { setZoom(nextZoom); return }
      const imageRect = image.getBoundingClientRect()
      pendingAnchor.current = {
        clientX: anchor.clientX,
        clientY: anchor.clientY,
        imageX: imageRect.width ? (anchor.clientX - imageRect.left) / imageRect.width : 0.5,
        imageY: imageRect.height ? (anchor.clientY - imageRect.top) / imageRect.height : 0.5
      }
      setZoom(nextZoom)
    },
    onPinchStart: (anchor) => {
      const image = imageRef.current
      if (!image) return
      const rect = image.getBoundingClientRect()
      pinch.current = {
        imageX: rect.width ? (anchor.clientX - rect.left) / rect.width : 0.5,
        imageY: rect.height ? (anchor.clientY - rect.top) / rect.height : 0.5,
        baseZoom: zoom,
        rect
      }
      image.style.transformOrigin = '0 0'
      image.style.willChange = 'transform'
    },
    onPinchPreview: (nextZoom, anchor) => {
      const image = imageRef.current
      const session = pinch.current
      if (!image || !session) return
      const scale = nextZoom / session.baseZoom
      const localX = session.imageX * session.rect.width
      const localY = session.imageY * session.rect.height
      const translateX = anchor.clientX - session.rect.left - localX * scale
      const translateY = anchor.clientY - session.rect.top - localY * scale
      image.style.transform = `matrix(${scale}, 0, 0, ${scale}, ${translateX}, ${translateY})`
    },
    onPinchEnd: (nextZoom, anchor) => {
      const image = imageRef.current
      const session = pinch.current
      if (!image || !session) { setZoom(nextZoom); return }
      pendingAnchor.current = { clientX: anchor.clientX, clientY: anchor.clientY, imageX: session.imageX, imageY: session.imageY }
      pinch.current = null
      image.style.transform = ''
      image.style.transformOrigin = ''
      image.style.willChange = ''
      setZoom(nextZoom)
    }
  })
  const centerImage = () => {
    const stage = stageElementRef.current
    if (!stage) return
    stage.scrollTo({
      left: Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2),
      top: Math.max(0, (stage.scrollHeight - stage.clientHeight) / 2)
    })
  }
  useLayoutEffect(() => {
    const stage = stageElementRef.current
    const image = imageRef.current
    const anchor = pendingAnchor.current
    pendingAnchor.current = null
    if (!stage || !image || !anchor) { centerImage(); return }
    const imageRect = image.getBoundingClientRect()
    stage.scrollBy({
      left: imageRect.left + imageRect.width * anchor.imageX - anchor.clientX,
      top: imageRect.top + imageRect.height * anchor.imageY - anchor.clientY
    })
  // The image canvas has been resized before this layout effect runs, so the
  // anchor correction happens before paint and never flashes a centered frame.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom])
  return <div className="image-preview" data-testid="image-preview">
    <div className="image-toolbar">
      <IconButton icon={Minus} label={t('zoomOut')} onClick={() => setZoom((value) => Math.max(25, value - 25))} />
      <span>{zoom}%</span>
      <IconButton icon={Plus} label={t('zoomIn')} onClick={() => setZoom((value) => Math.min(400, value + 25))} />
      <IconButton icon={Maximize2} label={t('fit')} onClick={() => setZoom(100)} />
    </div>
    <div ref={stageRef} className="image-stage">
      <div className="image-canvas" style={{ width: `${Math.max(100, zoom)}%` }}>
        <img ref={imageRef} src={src} alt={name} style={{ width: `${Math.min(100, zoom)}%` }} onLoad={centerImage} onError={onError} />
      </div>
    </div>
  </div>
}
