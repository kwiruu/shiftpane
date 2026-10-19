import { type RefObject, useLayoutEffect, useState } from 'react'

export interface ElementSize {
  width: number
  height: number
}

/** The content-box size of an element in CSS pixels, kept current with a ResizeObserver. */
export function useElementSize(ref: RefObject<HTMLElement | null>): ElementSize {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const set = (width: number, height: number) =>
      setSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      )
    // Measure once now so the first paint is already laid out; the observer keeps it current.
    const style = getComputedStyle(element)
    set(
      element.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight),
      element.clientHeight -
        Number.parseFloat(style.paddingTop) -
        Number.parseFloat(style.paddingBottom),
    )
    const observer = new ResizeObserver(([entry]) => {
      if (entry) set(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return size
}
