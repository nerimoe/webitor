import { useEffect, useState } from 'react'
import { Maximize2, Minus, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from './IconButton'
import { useLocalZoom } from './useLocalZoom'

export function ImagePreview({ src, name }: { src: string; name: string }) {
  const { t } = useTranslation()
  const [zoom, setZoom] = useState(100)
  const stageRef = useLocalZoom<HTMLDivElement>(zoom, setZoom, { min: 25, max: 400, step: 10 })
  const centerImage = () => {
    const stage = stageRef.current
    if (!stage) return
    stage.scrollTo({
      left: Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2),
      top: Math.max(0, (stage.scrollHeight - stage.clientHeight) / 2)
    })
  }
  useEffect(() => {
    const frame = requestAnimationFrame(centerImage)
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
