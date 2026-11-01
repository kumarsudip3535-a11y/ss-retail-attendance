import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { SceneHandle, SceneVariant } from '@/three/routeGlobeScene'

/**
 * App-wide 3D backdrop (the animated route globe), rendered once behind
 * every route. three.js is loaded lazily in its own chunk, so first paint
 * and the login form never wait on it.
 *
 * Falls back to the static CSS gradient (always present underneath) when:
 *  - WebGL isn't available,
 *  - the user prefers reduced motion (renders one still frame instead),
 *  - Save-Data is on.
 */
function detectLowPower(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } }
  const cores = nav.hardwareConcurrency ?? 8
  const mem = nav.deviceMemory ?? 8
  return cores <= 4 || mem <= 3
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

export default function Background3D() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const handleRef = useRef<SceneHandle | null>(null)
  const location = useLocation()
  const variant: SceneVariant = location.pathname === '/login' || location.pathname === '/' ? 'hero' : 'ambient'
  const variantRef = useRef(variant)
  variantRef.current = variant
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const nav = navigator as Navigator & { connection?: { saveData?: boolean } }
    if (nav.connection?.saveData || !hasWebGL()) return
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    let cancelled = false

    import('@/three/routeGlobeScene')
      .then(({ createRouteGlobeScene }) => {
        if (cancelled || !canvasRef.current) return
        handleRef.current = createRouteGlobeScene(canvasRef.current, {
          variant: variantRef.current,
          still,
          lowPower: detectLowPower(),
        })
        setReady(true)
      })
      .catch((err) => console.warn('[Background3D] 3D scene unavailable, using static background:', err))

    return () => {
      cancelled = true
      handleRef.current?.dispose()
      handleRef.current = null
    }
  }, [])

  useEffect(() => {
    handleRef.current?.setVariant(variant)
  }, [variant])

  return (
    <div aria-hidden="true" className="bg3d-root">
      <div className="bg3d-gradient" />
      <canvas ref={canvasRef} className={`bg3d-canvas ${ready ? 'is-ready' : ''}`} />
      <div className="bg3d-grid" />
    </div>
  )
}
