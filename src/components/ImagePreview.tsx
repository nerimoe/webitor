import { useLayoutEffect, useRef, useState } from 'react'
import { Maximize2, Minus, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from './IconButton'
import { useLocalZoom, type ZoomAnchor } from './useLocalZoom'

export function ImagePreview({ src, name }: { src: string; name: string }) {
  const { t } = useTranslation()
  const [zoom, setZoom] = useState(100)
  const pendingAnchor = useRef<{ localX: number; localY: number; contentX: number; contentY: number; width: number; height: number } | null>(null)
  const stageRef = useLocalZoom<HTMLDivElement>(zoom, setZoom, {
    min: 25,
    max: 400,
    step: 10,
    onZoomAt: (nextZoom, anchor: ZoomAnchor) => {
      const stage = stageRef.current
      if (!stage) { setZoom(nextZoom); return }
      const rect = stage.getBoundingClientRect()
      const localX = anchor.clientX - rect.left
      const localY = anchor.clientY - rect.top
      pendingAnchor.current = {
        localX,
        localY,
        contentX: stage.scrollLeft + localX,
        contentY: stage.scrollTop + localY,
        width: stage.scrollWidth,
        height: stage.scrollHeight
      }
      setZoom(nextZoom)
    }
  })
  const centerImage = () => {
    const stage = stageRef.current
    if (!stage) return
    stage.scrollTo({
      left: Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2),
      top: Math.max(0, (stage.scrollHeight - stage.clientHeight) / 2)
    })
  }
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      const stage = stageRef.current
      const anchor = pendingAnchor.current
      pendingAnchor.current = null
      if (!stage || !anchor) { centerImage(); return }
      stage.scrollTo({
        left: anchor.contentX * (stage.scrollWidth / anchor.width) - anchor.localX,
        top: anchor.contentY * (stage.scrollHeight / anchor.height) - anchor.localY
      })
    })
    return () => cancelAnimationFrame(frame)
  // The image canvas is resized by zoom before this effect runs.
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
        <img src={src} alt={name} style={{ width: `${Math.min(100, zoom)}%` }} onLoad={centerImage} />
      </div>
    </div>
  </div>
}
