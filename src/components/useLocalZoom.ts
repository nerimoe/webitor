import { useCallback, useEffect, useRef, useState } from 'react'

interface Options {
  min: number
  max: number
  step: number
  onZoomAt?: (value: number, anchor: ZoomAnchor) => void
  onPinchStart?: (anchor: ZoomAnchor) => void
  onPinchPreview?: (value: number, anchor: ZoomAnchor) => void
  onPinchEnd?: (value: number, anchor: ZoomAnchor) => void
}

export interface ZoomAnchor { clientX: number; clientY: number }

interface PointerMemory { position: ZoomAnchor | null; listening: boolean }

const pointerWindow = window as Window & { __webitorPointerMemory?: PointerMemory }
const pointerMemory = pointerWindow.__webitorPointerMemory ??= { position: null, listening: false }
if (!pointerMemory.listening) {
  const rememberPointer = (event: MouseEvent | PointerEvent) => {
    pointerMemory.position = { clientX: event.clientX, clientY: event.clientY }
  }
  window.addEventListener('pointermove', rememberPointer, { passive: true })
  window.addEventListener('mousemove', rememberPointer, { passive: true })
  pointerMemory.listening = true
}

const clamp = (value: number, { min, max }: Options) => Math.max(min, Math.min(max, value))

/** Handles trackpad pinch and iOS gesture events only inside the supplied surface. */
export function useLocalZoom<T extends HTMLElement>(value: number, setValue: (value: number) => void, options: Options) {
  const elementRef = useRef<T>(null)
  const [element, setElement] = useState<T | null>(null)
  const ref = useCallback((node: T | null) => {
    elementRef.current = node
    setElement(node)
  }, [])
  const valueRef = useRef(value)
  const optionsRef = useRef(options)
  const setValueRef = useRef(setValue)
  const pinchStart = useRef<number | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pointerStart = useRef<{ distance: number; value: number } | null>(null)

  useEffect(() => { valueRef.current = value }, [value])
  optionsRef.current = options
  setValueRef.current = setValue

  useEffect(() => {
    if (!element) return
    let frame = 0
    let queued: { value: number; anchor?: ZoomAnchor } | null = null
    let pinchFrame = 0
    let queuedPinch: { value: number; anchor: ZoomAnchor } | null = null
    let lastPinch: { value: number; anchor: ZoomAnchor } | null = null
    const update = (next: number, anchor?: ZoomAnchor) => {
      const value = Math.round(clamp(next, optionsRef.current))
      valueRef.current = value
      queued = { value, anchor }
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const pending = queued
        queued = null
        if (!pending) return
        const currentOptions = optionsRef.current
        if (pending.anchor && currentOptions.onZoomAt) currentOptions.onZoomAt(pending.value, pending.anchor)
        else setValueRef.current(pending.value)
      })
    }
    const previewPinch = (next: number, anchor: ZoomAnchor) => {
      const pending = { value: Math.round(clamp(next, optionsRef.current)), anchor }
      lastPinch = pending
      if (!optionsRef.current.onPinchPreview) { update(pending.value, anchor); return }
      queuedPinch = pending
      if (pinchFrame) return
      pinchFrame = requestAnimationFrame(() => {
        pinchFrame = 0
        const preview = queuedPinch
        queuedPinch = null
        if (preview) optionsRef.current.onPinchPreview?.(preview.value, preview.anchor)
      })
    }
    const finishPinch = () => {
      if (!lastPinch) return
      if (pinchFrame) cancelAnimationFrame(pinchFrame)
      pinchFrame = 0
      queuedPinch = null
      const final = lastPinch
      lastPinch = null
      if (optionsRef.current.onPinchEnd) optionsRef.current.onPinchEnd(final.value, final.anchor)
      else update(final.value, final.anchor)
    }
    const elementCenter = () => {
      const rect = element.getBoundingClientRect()
      return { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }
    }
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return
      event.preventDefault()
      const anchor = { clientX: event.clientX, clientY: event.clientY }
      pointerMemory.position = anchor
      update(valueRef.current - Math.sign(event.deltaY || 1) * optionsRef.current.step, anchor)
    }
    const onGestureStart = (event: Event) => {
      event.preventDefault()
      if (pointerStart.current) return
      pinchStart.current = valueRef.current
      const gesture = event as Event & { clientX?: number; clientY?: number }
      const anchor = typeof gesture.clientX === 'number' && typeof gesture.clientY === 'number' && (gesture.clientX !== 0 || gesture.clientY !== 0)
        ? { clientX: gesture.clientX, clientY: gesture.clientY }
        : pointerMemory.position ?? elementCenter()
      optionsRef.current.onPinchStart?.(anchor)
    }
    const onGestureChange = (event: Event) => {
      event.preventDefault()
      if (pointerStart.current) return
      const scale = (event as Event & { scale?: number }).scale ?? 1
      const gesture = event as Event & { clientX?: number; clientY?: number }
      const hasCoordinates = typeof gesture.clientX === 'number' && typeof gesture.clientY === 'number' && (gesture.clientX !== 0 || gesture.clientY !== 0)
      const anchor = hasCoordinates
        ? { clientX: gesture.clientX!, clientY: gesture.clientY! }
        : pointerMemory.position ?? elementCenter()
      previewPinch((pinchStart.current ?? valueRef.current) * scale, anchor)
    }
    const onGestureEnd = (event: Event) => {
      event.preventDefault()
      if (pointerStart.current) return
      finishPinch()
      pinchStart.current = null
    }
    const distance = () => {
      const [first, second] = [...pointers.current.values()]
      return first && second ? Math.hypot(first.x - second.x, first.y - second.y) : 0
    }
    const pointerCenter = () => {
      const [first, second] = [...pointers.current.values()]
      return first && second
        ? { clientX: (first.x + second.x) / 2, clientY: (first.y + second.y) / 2 }
        : elementCenter()
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (pointers.current.size === 2) {
        pointerStart.current = { distance: distance(), value: valueRef.current }
        optionsRef.current.onPinchStart?.(pointerCenter())
      }
    }
    const onPointerMove = (event: PointerEvent) => {
      pointerMemory.position = { clientX: event.clientX, clientY: event.clientY }
      if (!pointers.current.has(event.pointerId)) return
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      const start = pointerStart.current
      if (!start || pointers.current.size < 2 || !start.distance) return
      event.preventDefault()
      previewPinch(start.value * (distance() / start.distance), pointerCenter())
    }
    const onPointerEnd = (event: PointerEvent) => {
      pointers.current.delete(event.pointerId)
      if (pointers.current.size < 2 && pointerStart.current) {
        finishPinch()
        pointerStart.current = null
      }
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    element.addEventListener('gesturestart', onGestureStart, { passive: false })
    element.addEventListener('gesturechange', onGestureChange, { passive: false })
    element.addEventListener('gestureend', onGestureEnd, { passive: false })
    element.addEventListener('pointerdown', onPointerDown)
    element.addEventListener('pointermove', onPointerMove, { passive: false })
    element.addEventListener('pointerup', onPointerEnd)
    element.addEventListener('pointercancel', onPointerEnd)
    return () => {
      element.removeEventListener('wheel', onWheel)
      element.removeEventListener('gesturestart', onGestureStart)
      element.removeEventListener('gesturechange', onGestureChange)
      element.removeEventListener('gestureend', onGestureEnd)
      element.removeEventListener('pointerdown', onPointerDown)
      element.removeEventListener('pointermove', onPointerMove)
      element.removeEventListener('pointerup', onPointerEnd)
      element.removeEventListener('pointercancel', onPointerEnd)
      if (frame) cancelAnimationFrame(frame)
      if (pinchFrame) cancelAnimationFrame(pinchFrame)
    }
  }, [element])

  return { ref, elementRef }
}
