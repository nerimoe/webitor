import { useState } from 'react'
import { Maximize2, Minus, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from './IconButton'
import { useLocalZoom } from './useLocalZoom'

export function ImagePreview({ src, name }: { src: string; name: string }) {
  const { t } = useTranslation()
  const [zoom, setZoom] = useState(100)
  const stageRef = useLocalZoom<HTMLDivElement>(zoom, setZoom, { min: 25, max: 400, step: 10 })
  return <div className="image-preview" data-testid="image-preview">
    <div className="image-toolbar">
      <IconButton icon={Minus} label={t('zoomOut')} onClick={() => setZoom((value) => Math.max(25, value - 25))} />
      <span>{zoom}%</span>
      <IconButton icon={Plus} label={t('zoomIn')} onClick={() => setZoom((value) => Math.min(400, value + 25))} />
      <IconButton icon={Maximize2} label={t('fit')} onClick={() => setZoom(100)} />
    </div>
    <div ref={stageRef} className="image-stage"><img src={src} alt={name} style={{ width: `${zoom}%` }} /></div>
  </div>
}
