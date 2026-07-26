import { useEffect, useRef } from 'react'

interface Options {
  min: number
  max: number
  step: number
  onZoomAt?: (value: number, anchor: ZoomAnchor) => void
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
  const ref = useRef<T>(null)
  const valueRef = useRef(value)
  const pinchStart = useRef<number | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pointerStart = useRef<{ distance: number; value: number } | null>(null)

  useEffect(() => { valueRef.current = value }, [value])

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const update = (next: number, anchor?: ZoomAnchor) => {
      const value = Math.round(clamp(next, options))
      valueRef.current = value
      if (anchor && options.onZoomAt) options.onZoomAt(value, anchor)
      else setValue(value)
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
      update(valueRef.current - Math.sign(event.deltaY || 1) * options.step, anchor)
    }
    const onGestureStart = (event: Event) => {
      event.preventDefault()
      if (pointerStart.current) return
      pinchStart.current = valueRef.current
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
      update((pinchStart.current ?? valueRef.current) * scale, anchor)
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
      if (pointers.current.size === 2) pointerStart.current = { distance: distance(), value: valueRef.current }
    }
    const onPointerMove = (event: PointerEvent) => {
      pointerMemory.position = { clientX: event.clientX, clientY: event.clientY }
      if (!pointers.current.has(event.pointerId)) return
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      const start = pointerStart.current
      if (!start || pointers.current.size < 2 || !start.distance) return
      event.preventDefault()
      update(start.value * (distance() / start.distance), pointerCenter())
    }
    const onPointerEnd = (event: PointerEvent) => {
      pointers.current.delete(event.pointerId)
      if (pointers.current.size < 2) pointerStart.current = null
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    element.addEventListener('gesturestart', onGestureStart, { passive: false })
    element.addEventListener('gesturechange', onGestureChange, { passive: false })
    element.addEventListener('pointerdown', onPointerDown)
    element.addEventListener('pointermove', onPointerMove, { passive: false })
    element.addEventListener('pointerup', onPointerEnd)
    element.addEventListener('pointercancel', onPointerEnd)
    return () => {
      element.removeEventListener('wheel', onWheel)
      element.removeEventListener('gesturestart', onGestureStart)
      element.removeEventListener('gesturechange', onGestureChange)
      element.removeEventListener('pointerdown', onPointerDown)
      element.removeEventListener('pointermove', onPointerMove)
      element.removeEventListener('pointerup', onPointerEnd)
      element.removeEventListener('pointercancel', onPointerEnd)
    }
  }, [options, setValue])

  return ref
}
