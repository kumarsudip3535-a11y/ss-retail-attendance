import * as THREE from 'three'

/**
 * 3D animated backdrop: a dotted globe centred on India with glowing
 * route arcs, travelling "field staff" pulses, pinging location pins and
 * a slow particle field — the visual language of the Live Tracking
 * module. Plain three.js (no React renderer) so it can be lazy-loaded as
 * one chunk and fully torn down on unmount.
 *
 * Two variants:
 *  - 'hero'    (login): large, centred, full detail
 *  - 'ambient' (app pages): pushed to the corner, softer, fewer objects,
 *               capped at ~30 fps to be kind to field employees' batteries
 */

export type SceneVariant = 'hero' | 'ambient'

export interface SceneHandle {
  setVariant: (variant: SceneVariant) => void
  dispose: () => void
}

interface Options {
  variant: SceneVariant
  /** Render a single still frame and stop (prefers-reduced-motion). */
  still: boolean
  /** Fewer dots/particles and a lower pixel ratio on low-end devices. */
  lowPower: boolean
}

const GLOBE_RADIUS = 1
const INDIA_CITIES: [number, number][] = [
  [22.57, 88.36], // Kolkata
  [28.61, 77.21], // Delhi
  [19.08, 72.88], // Mumbai
  [13.08, 80.27], // Chennai
  [12.97, 77.59], // Bengaluru
  [17.39, 78.49], // Hyderabad
  [26.85, 80.95], // Lucknow
  [23.03, 72.58], // Ahmedabad
  [25.59, 85.14], // Patna
  [20.3, 85.82], // Bhubaneswar
  [26.14, 91.74], // Guwahati
  [21.15, 79.09], // Nagpur
]

function latLngToVec3(lat: number, lng: number, r = GLOBE_RADIUS): THREE.Vector3 {
  const phi = ((90 - lat) * Math.PI) / 180
  const theta = ((lng + 180) * Math.PI) / 180
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta))
}

function makeGlowTexture(): THREE.Texture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.6)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export function createRouteGlobeScene(canvas: HTMLCanvasElement, opts: Options): SceneHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !opts.lowPower, alpha: true, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.lowPower ? 1 : 1.75))
  renderer.setClearColor(0x000000, 0)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100)
  camera.position.set(0, 0, 4.2)

  const root = new THREE.Group() // positioned per variant
  scene.add(root)
  const globe = new THREE.Group() // spins
  root.add(globe)

  const glowTex = makeGlowTexture()
  const disposables: { dispose: () => void }[] = [glowTex]
  const track = <T extends { dispose: () => void }>(o: T): T => {
    disposables.push(o)
    return o
  }

  // --- Dotted sphere (fibonacci lattice) ---
  const dotCount = opts.lowPower ? 1400 : 3200
  const dotPositions = new Float32Array(dotCount * 3)
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < dotCount; i++) {
    const y = 1 - (i / (dotCount - 1)) * 2
    const r = Math.sqrt(1 - y * y)
    const theta = golden * i
    dotPositions.set([Math.cos(theta) * r * GLOBE_RADIUS, y * GLOBE_RADIUS, Math.sin(theta) * r * GLOBE_RADIUS], i * 3)
  }
  const dotGeo = track(new THREE.BufferGeometry())
  dotGeo.setAttribute('position', new THREE.BufferAttribute(dotPositions, 3))
  const dotMat = track(
    new THREE.PointsMaterial({ color: 0x6366f1, size: 0.018, transparent: true, opacity: 0.55, depthWrite: false })
  )
  globe.add(new THREE.Points(dotGeo, dotMat))

  // Inner solid sphere to occlude back-side dots slightly
  const coreGeo = track(new THREE.SphereGeometry(GLOBE_RADIUS * 0.985, 48, 48))
  const coreMat = track(new THREE.MeshBasicMaterial({ color: 0xeef2ff, transparent: true, opacity: 0.55 }))
  globe.add(new THREE.Mesh(coreGeo, coreMat))

  // Atmosphere glow (sprite behind globe)
  const atmoMat = track(
    new THREE.SpriteMaterial({ map: glowTex, color: 0x818cf8, transparent: true, opacity: 0.35, depthWrite: false })
  )
  const atmo = new THREE.Sprite(atmoMat)
  atmo.scale.set(3.4, 3.4, 1)
  atmo.position.z = -0.4
  root.add(atmo)

  // Equatorial orbit rings
  const ringMat = track(new THREE.MeshBasicMaterial({ color: 0x0ea5e9, transparent: true, opacity: 0.18, side: THREE.DoubleSide }))
  for (const [radius, tilt] of [
    [1.35, 0.35],
    [1.6, -0.55],
  ] as const) {
    const ringGeo = track(new THREE.RingGeometry(radius, radius + 0.006, 128))
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.rotation.x = Math.PI / 2 + tilt
    root.add(ring)
  }

  // --- City pins ---
  const pinMat = track(new THREE.SpriteMaterial({ map: glowTex, color: 0x10b981, transparent: true, depthWrite: false }))
  const pins: { sprite: THREE.Sprite; phase: number }[] = []
  INDIA_CITIES.forEach(([lat, lng], i) => {
    const s = new THREE.Sprite(pinMat.clone())
    disposables.push(s.material)
    s.position.copy(latLngToVec3(lat, lng, GLOBE_RADIUS * 1.01))
    s.scale.setScalar(0.035)
    globe.add(s)
    pins.push({ sprite: s, phase: i * 0.7 })
  })

  // --- Route arcs with travelling pulses ---
  const arcPairs: [number, number][] = [
    [0, 8], [8, 6], [6, 1], [1, 7], [7, 2], [2, 4], [4, 3], [3, 5], [5, 11], [11, 0], [0, 10], [0, 9], [9, 3],
  ]
  const arcs: { curve: THREE.QuadraticBezierCurve3; pulse: THREE.Sprite; speed: number; offset: number }[] = []
  const pulseMat = track(new THREE.SpriteMaterial({ map: glowTex, color: 0xf59e0b, transparent: true, depthWrite: false }))
  arcPairs.slice(0, opts.lowPower ? 7 : arcPairs.length).forEach(([a, b], i) => {
    const start = latLngToVec3(...INDIA_CITIES[a], GLOBE_RADIUS * 1.01)
    const end = latLngToVec3(...INDIA_CITIES[b], GLOBE_RADIUS * 1.01)
    const mid = start.clone().add(end).multiplyScalar(0.5)
    mid.normalize().multiplyScalar(GLOBE_RADIUS + start.distanceTo(end) * 0.8)
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end)
    const geo = track(new THREE.BufferGeometry().setFromPoints(curve.getPoints(48)))
    const mat = track(
      new THREE.LineBasicMaterial({ color: i % 2 ? 0x4f46e5 : 0x0284c7, transparent: true, opacity: 0.9 })
    )
    globe.add(new THREE.Line(geo, mat))
    const pulse = new THREE.Sprite(pulseMat)
    pulse.scale.setScalar(0.04)
    globe.add(pulse)
    arcs.push({ curve, pulse, speed: 0.12 + (i % 4) * 0.03, offset: i * 0.37 })
  })

  // --- Floating particle field ---
  const particleCount = opts.lowPower ? 120 : 320
  const pPos = new Float32Array(particleCount * 3)
  for (let i = 0; i < particleCount; i++) {
    pPos.set([(Math.random() - 0.5) * 12, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 6 - 1.5], i * 3)
  }
  const pGeo = track(new THREE.BufferGeometry())
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3))
  const pMat = track(
    new THREE.PointsMaterial({ color: 0xa5b4fc, size: 0.035, map: glowTex, transparent: true, opacity: 0.7, depthWrite: false })
  )
  const particles = new THREE.Points(pGeo, pMat)
  scene.add(particles)

  // Face India (≈22°N 82°E) straight at the camera. Euler 'XYZ' applies
  // the Y rotation first, then X — solve each in turn.
  const india = latLngToVec3(21, 81)
  const baseRotY = Math.atan2(-india.x, india.z)
  const baseRotX = Math.atan2(india.y, Math.hypot(india.x, india.z))
  globe.rotation.set(baseRotX, baseRotY, 0)

  // --- Variant layout ---
  let variant: SceneVariant = opts.variant
  const target = { x: 0, y: 0, scale: 1, opacity: 1 }
  const current = { x: 0, y: 0, scale: 1, opacity: 1 }
  function computeTarget() {
    const w = canvas.clientWidth || window.innerWidth
    const h = canvas.clientHeight || window.innerHeight
    const aspect = w / Math.max(1, h)
    const narrow = aspect < 0.9
    // Visible half-width of the view plane at z=0 for this camera.
    const halfH = camera.position.z * Math.tan((camera.fov * Math.PI) / 360)
    const halfW = halfH * aspect
    if (variant === 'hero') {
      target.x = narrow ? 0 : Math.max(0.9, halfW * 0.5)
      target.y = narrow ? halfH * 0.62 : 0
      target.scale = narrow ? 0.85 : Math.min(1.55, halfH * 0.95)
      target.opacity = 1
    } else {
      target.x = narrow ? halfW * 0.6 : halfW * 0.78
      target.y = narrow ? -halfH * 0.8 : -halfH * 0.45
      target.scale = narrow ? 0.9 : 1.05
      target.opacity = 0.5
    }
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth
    const h = canvas.clientHeight || window.innerHeight
    renderer.setSize(w, h, false)
    camera.aspect = w / Math.max(1, h)
    camera.updateProjectionMatrix()
    computeTarget()
  }
  resize()
  Object.assign(current, target)
  window.addEventListener('resize', resize)

  // Pointer parallax
  const pointer = { x: 0, y: 0 }
  const onPointer = (e: PointerEvent) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1
  }
  window.addEventListener('pointermove', onPointer, { passive: true })

  const clock = new THREE.Clock()
  let raf = 0
  let lastFrame = 0
  let disposed = false

  function frame(now: number) {
    if (disposed) return
    raf = requestAnimationFrame(frame)
    const minFrameMs = variant === 'ambient' || opts.lowPower ? 33 : 0
    if (now - lastFrame < minFrameMs) return
    lastFrame = now
    renderOnce()
  }

  function setOpacity(o: number) {
    dotMat.opacity = 0.55 * o
    coreMat.opacity = 0.55 * o
    atmoMat.opacity = 0.35 * o
    ringMat.opacity = 0.18 * o
    pMat.opacity = 0.7 * Math.max(o, 0.6)
  }

  function renderOnce() {
    const t = clock.getElapsedTime()
    const ease = 0.06
    current.x += (target.x - current.x) * ease
    current.y += (target.y - current.y) * ease
    current.scale += (target.scale - current.scale) * ease
    current.opacity += (target.opacity - current.opacity) * ease
    root.position.set(current.x, current.y, 0)
    root.scale.setScalar(current.scale)
    setOpacity(current.opacity)

    // Gentle sway around India rather than a full spin, so the routes stay in view.
    globe.rotation.y = baseRotY + Math.sin(t * 0.18) * 0.2
    globe.rotation.x = baseRotX + Math.sin(t * 0.13) * 0.06
    camera.position.x += (pointer.x * 0.25 - camera.position.x) * 0.04
    camera.position.y += (-pointer.y * 0.18 - camera.position.y) * 0.04
    // Turn the whole globe to face the camera from wherever it sits on
    // screen (otherwise perspective pushes India off-centre when the globe
    // is offset to the side), plus a little pointer parallax.
    root.rotation.y = Math.atan2(camera.position.x - current.x, camera.position.z) + pointer.x * 0.12
    root.rotation.x = -Math.atan2(camera.position.y - current.y, camera.position.z) + pointer.y * 0.08
    camera.lookAt(0, 0, 0)

    for (const p of pins) {
      const s = 0.03 + Math.abs(Math.sin(t * 2 + p.phase)) * 0.035
      p.sprite.scale.setScalar(s)
      ;(p.sprite.material as THREE.SpriteMaterial).opacity = 0.5 + Math.abs(Math.sin(t * 2 + p.phase)) * 0.5
    }
    for (const a of arcs) {
      const u = (t * a.speed + a.offset) % 1
      a.pulse.position.copy(a.curve.getPoint(u))
    }
    particles.rotation.y = t * 0.015
    particles.position.y = Math.sin(t * 0.2) * 0.1

    renderer.render(scene, camera)
  }

  if (opts.still) {
    Object.assign(current, target)
    renderOnce()
  } else {
    raf = requestAnimationFrame(frame)
  }

  return {
    setVariant(next) {
      variant = next
      computeTarget()
      if (opts.still) {
        Object.assign(current, target)
        renderOnce()
      }
    },
    dispose() {
      disposed = true
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onPointer)
      disposables.forEach((d) => d.dispose())
      renderer.dispose()
    },
  }
}
