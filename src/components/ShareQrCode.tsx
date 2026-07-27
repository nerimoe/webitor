import { useEffect, useRef } from 'react'
import QRCode from 'qrcode'

export function ShareQrCode({ url, label }: { url: string; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    void QRCode.toCanvas(canvas, url, {
      width: 192,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' }
    })
  }, [url])

  return <canvas ref={canvasRef} className="share-qr-code" role="img" aria-label={label} />
}
