import { useEffect } from 'react'

/**
 * Gives `.card-3d` and `.tilt-tile` elements a subtle 3D tilt + moving
 * light sheen that follows the pointer. One delegated listener for the
 * whole app instead of a hook in every component.
 *
 * Deliberately skipped:
 *  - touch / coarse pointers (phones — tilt fights with scrolling),
 *  - prefers-reduced-motion,
 *  - cards containing a Leaflet map or a focused form field (tilting
 *    something you're dragging or typing into is disorienting).
 */
const MAX_TILT_CARD = 2.5 // degrees
const MAX_TILT_TILE = 7

export default function TiltController() {
  useEffect(() => {
    const fine = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? false
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    if (!fine || reduced) return

    let active: HTMLElement | null = null
    let frame = 0

    const reset = (el: HTMLElement) => {
      el.style.removeProperty('--tilt-x')
      el.style.removeProperty('--tilt-y')
      el.style.removeProperty('--sheen-x')
      el.style.removeProperty('--sheen-y')
      el.classList.remove('is-tilting')
    }

    const onMove = (e: PointerEvent) => {
      const target = (e.target as HTMLElement | null)?.closest?.('.tilt-tile, .card-3d') as HTMLElement | null
      if (active && active !== target) {
        reset(active)
        active = null
      }
      if (!target) return
      const typingInside =
        target.contains(document.activeElement) && !!document.activeElement?.matches('input, textarea, select')
      if (target.querySelector('.leaflet-container') || typingInside) {
        return
      }
      active = target
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const r = target.getBoundingClientRect()
        const px = (e.clientX - r.left) / r.width
        const py = (e.clientY - r.top) / r.height
        const max = target.classList.contains('tilt-tile') ? MAX_TILT_TILE : MAX_TILT_CARD
        target.style.setProperty('--tilt-x', `${((0.5 - py) * 2 * max).toFixed(2)}deg`)
        target.style.setProperty('--tilt-y', `${((px - 0.5) * 2 * max).toFixed(2)}deg`)
        target.style.setProperty('--sheen-x', `${(px * 100).toFixed(1)}%`)
        target.style.setProperty('--sheen-y', `${(py * 100).toFixed(1)}%`)
        target.classList.add('is-tilting')
      })
    }
    const onLeave = () => {
      if (active) reset(active)
      active = null
    }

    document.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerleave', onLeave)
    window.addEventListener('blur', onLeave)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('blur', onLeave)
    }
  }, [])

  return null
}
