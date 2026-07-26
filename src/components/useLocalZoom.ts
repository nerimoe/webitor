import { useEffect, useRef } from 'react'

interface Options {
  min: number
  max: number
  step: number
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
    const update = (next: number) => setValue(Math.round(clamp(next, options)))
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return
      event.preventDefault()
      update(valueRef.current - Math.sign(event.deltaY || 1) * options.step)
    }
    const onGestureStart = (event: Event) => {
      event.preventDefault()
      pinchStart.current = valueRef.current
    }
    const onGestureChange = (event: Event) => {
      event.preventDefault()
      const scale = (event as Event & { scale?: number }).scale ?? 1
      update((pinchStart.current ?? valueRef.current) * scale)
    }
    const distance = () => {
      const [first, second] = [...pointers.current.values()]
      return first && second ? Math.hypot(first.x - second.x, first.y - second.y) : 0
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (pointers.current.size === 2) pointerStart.current = { distance: distance(), value: valueRef.current }
    }
    const onPointerMove = (event: PointerEvent) => {
      if (!pointers.current.has(event.pointerId)) return
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      const start = pointerStart.current
      if (!start || pointers.current.size < 2 || !start.distance) return
      event.preventDefault()
      update(start.value * (distance() / start.distance))
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
