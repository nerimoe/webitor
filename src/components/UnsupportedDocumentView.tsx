import { useEffect } from 'react'
import { FileWarning } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DocumentViewProps } from '../documentFormats/types'

export default function UnsupportedDocumentView({ registerController }: DocumentViewProps) {
  const { t } = useTranslation()
  useEffect(() => {
    registerController(null)
  }, [registerController])
  return <div className="media-preview-unavailable" role="status"><FileWarning size={36} /><span>{t('documentViewUnavailable')}</span></div>
}
