import { useEffect, useRef, useState } from 'react'

export interface OverflowAction {
  id: string
  priority: number
}

/**
 * Keeps an icon toolbar from stealing the document title. Hidden actions are
 * rendered by the caller in its overflow menu instead of becoming scrollable.
 */
export function useActionOverflow<T extends OverflowAction>(items: T[], options: { alwaysOverflow?: boolean } = {}) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState<number | null>(null)
  const itemKey = items.map((item) => `${item.id}:${item.priority}`).join('|')

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const update = () => setWidth(element.getBoundingClientRect().width)
    update()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [itemKey])

  if (width === null || width <= 0) return { ref, visible: items, overflow: [] as T[] }

  const slots = Math.max(1, Math.floor((width - 2) / 44))
  const needsOverflow = options.alwaysOverflow || items.length > slots
  const directSlots = needsOverflow ? Math.max(0, slots - 1) : items.length
  const visibleIds = new Set([...items].sort((a, b) => a.priority - b.priority).slice(0, directSlots).map((item) => item.id))

  return {
    ref,
    visible: items.filter((item) => visibleIds.has(item.id)),
    overflow: items.filter((item) => !visibleIds.has(item.id))
  }
}
