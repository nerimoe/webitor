import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useTranslation } from 'react-i18next'
import { receivePickupCode, type PickupProgress } from '../lib/pickupCode'
import { ShareLinkError, type SharedFile } from '../lib/shareLink'
import { TransferStatus } from './TransferStatus'

export function PickupReceiveDialog({ open, onOpenChange, onReceive }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onReceive: (file: SharedFile) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const [code, setCode] = useState('')
  const [progress, setProgress] = useState<PickupProgress | null>(null)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setCode('')
    setErrorKey(null)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  const receive = async () => {
    if (code.length !== 6 || progress) return
    setErrorKey(null)
    try {
      const file = await receivePickupCode(code, setProgress)
      await onReceive(file)
      onOpenChange(false)
    } catch (error) {
      if (!(error instanceof ShareLinkError)) setErrorKey('pickupReceiveFailed')
      else setErrorKey({
        invalid: 'pickupInvalid',
        notFound: 'pickupNotFound',
        expired: 'pickupExpired',
        tooLarge: 'pickupTooLarge',
        rateLimited: 'pickupReceiveRateLimited',
        network: 'pickupReceiveFailed',
        missing: 'pickupInvalid',
        unsupportedCompression: 'sharedFileCompressionUnsupported',
        unsupportedMedia: 'sharedFileUnsupportedMedia',
        unsupportedVersion: 'sharedFileUnsupportedVersion'
      }[error.code])
    } finally {
      setProgress(null)
    }
  }

  return <Dialog.Root open={open} onOpenChange={(next) => { if (!progress) onOpenChange(next) }}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content className="dialog-content pickup-receive-dialog" onEscapeKeyDown={(event) => { if (progress) event.preventDefault() }} onPointerDownOutside={(event) => { if (progress) event.preventDefault() }}>
        <Dialog.Title>{t('receivePickupTitle')}</Dialog.Title>
        <Dialog.Description>{t('receivePickupBody')}</Dialog.Description>
        <input
          ref={inputRef}
          className="pickup-code-input"
          aria-label={t('pickupCode')}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(event) => {
            setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
            setErrorKey(null)
          }}
          onKeyDown={(event) => { if (event.key === 'Enter') void receive() }}
        />
        {errorKey && <p className="dialog-error" role="alert">{t(errorKey)}</p>}
        {progress && <TransferStatus label={t(`pickupPhase_${progress.phase}`)} progress={progress.progress} />}
        <div className="dialog-actions">
          <Dialog.Close asChild><button className="secondary-button" disabled={Boolean(progress)}>{t('cancel')}</button></Dialog.Close>
          <button className="primary-button" disabled={code.length !== 6 || Boolean(progress)} onClick={() => void receive()}>{t(progress ? 'receivingPickup' : 'receivePickup')}</button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
