import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'
import * as d3 from 'd3'
import type { GeoRotation } from './globeProjection'
import { isVisible } from './globeProjection'
import type { Earthquake } from '../../lib/types'

// ─── Design tokens (must match CSS --accent) ─────────────────────────────────
const ACCENT_RGB = [245, 163, 92] as const

// ─── Globe constants ──────────────────────────────────────────────────────────
const LAND_URL  = 'https://raw.githubusercontent.com/martynafford/natural-earth-geojson/refs/heads/master/110m/physical/ne_110m_land.json'
const FAULT_URL = 'https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json'

const ROTATION_SPEED = 0.06
const MIN_SCALE      = 0.5
const MAX_SCALE      = 3.0
const FAULT_HIT_PX   = 8
const FAULT_SAMPLE   = 5

// ─── Pulse ring config per magnitude tier ────────────────────────────────────
function ringConfig(mag: number) {
  if (mag >= 6) return { rings: 3, cyclems: 1800, maxOpacity: 0.80, expand: 3.8 }
  if (mag >= 4) return { rings: 2, cyclems: 2400, maxOpacity: 0.55, expand: 3.0 }
  return           { rings: 2, cyclems: 3200, maxOpacity: 0.32, expand: 2.4 }
}

// ─── Seeded pseudo-random for reproducible starfield ─────────────────────────
function seededRand(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

// ─── Generate fixed star set ──────────────────────────────────────────────────
interface Star { nx: number; ny: number; r: number; opacity: number }

function generateStars(count = 260): Star[] {
  const rand = seededRand(0xDEADBEEF)
  return Array.from({ length: count }, () => ({
    nx:      rand(),
    ny:      rand(),
    r:       0.4 + rand() * 1.7,
    opacity: 0.12 + rand() * 0.72,
  }))
}
const STARS = generateStars()

// ─── Types ────────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GeoFeature = { type: string; geometry: { type: string; coordinates: any }; properties: Record<string, unknown> }
type GeoFeatureCollection = { type: string; features: GeoFeature[] }

export interface FaultFeature {
  boundaryType: string
  rawType:      string
  clickLat:     number
  clickLng:     number
}

export interface EarthGlobeHandle {
  getRotation:   () => GeoRotation
  getProjection: () => d3.GeoProjection | null
  getRadius:     () => number
}

interface EarthGlobeProps {
  onRotationChange: (r: GeoRotation) => void
  reducedMotion:    boolean
  showFaultLines:   boolean
  earthquakes:      Earthquake[]
  onFaultHover:  (f: FaultFeature | null, x: number, y: number) => void
  onFaultClick:  (f: FaultFeature) => void
}

// ─── Fault hit-detection ──────────────────────────────────────────────────────
function findHoveredFault(mx: number, my: number, features: GeoFeature[], proj: d3.GeoProjection): number {
  const t2 = FAULT_HIT_PX * FAULT_HIT_PX
  for (let fi = 0; fi < features.length; fi++) {
    const g = features[fi].geometry
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const coords: [number,number][] = g.type === 'LineString' ? g.coordinates : g.type === 'MultiLineString' ? (g.coordinates as any[][]).flat() : []
    for (let ci = 0; ci < coords.length; ci += FAULT_SAMPLE) {
      const pt = proj(coords[ci]); if (!pt) continue
      const dx = pt[0]-mx, dy = pt[1]-my
      if (dx*dx+dy*dy <= t2) return fi
    }
  }
  return -1
}

// ─── Component ───────────────────────────────────────────────────────────────
export const EarthGlobe = forwardRef<EarthGlobeHandle, EarthGlobeProps>(
  ({ onRotationChange, reducedMotion, showFaultLines, earthquakes, onFaultHover, onFaultClick }, ref) => {

  const containerRef    = useRef<HTMLDivElement>(null)
  const starCanvasRef   = useRef<HTMLCanvasElement>(null)   // z=0 starfield
  const canvasRef       = useRef<HTMLCanvasElement>(null)   // z=1 main globe
  const overlayCanvasRef= useRef<HTMLCanvasElement>(null)   // z=2 pulse rings

  // Globe state
  const rotationRef   = useRef<GeoRotation>([0, -25, 0])
  const scaleMultRef  = useRef(1)
  const scaleTargetRef= useRef(1)           // eased zoom target
  const projectionRef = useRef<d3.GeoProjection | null>(null)
  const radiusRef     = useRef(300)

  // Data
  const landRef        = useRef<GeoFeatureCollection | null>(null)
  const faultRef       = useRef<GeoFeatureCollection | null>(null)
  const landLoadedRef  = useRef(false)
  const faultLoadedRef = useRef(false)
  const earthquakesRef = useRef<Earthquake[]>(earthquakes)
  useEffect(() => { earthquakesRef.current = earthquakes }, [earthquakes])

  // Animation
  const globeTimerRef   = useRef<d3.Timer | null>(null)
  const overlayTimerRef = useRef<d3.Timer | null>(null)
  const autoRotateRef   = useRef(true)
  const draggingRef     = useRef(false)
  const dragEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragStartRotRef = useRef<GeoRotation>([0,-25,0])
  const dragStartPosRef = useRef<[number,number]>([0,0])

  // Inertia
  const velBufRef     = useRef<number[]>([])   // last N λ-velocities (deg/frame)
  const inertiaRef    = useRef(0)              // current coasting velocity
  const coastingRef   = useRef(false)

  // Hover
  const hoveredFaultRef = useRef(-1)

  // Prop refs (avoids stale closures in timers)
  const showFaultRef    = useRef(showFaultLines)
  useEffect(() => { showFaultRef.current = showFaultLines }, [showFaultLines])
  const onFaultHoverRef = useRef(onFaultHover)
  useEffect(() => { onFaultHoverRef.current = onFaultHover }, [onFaultHover])
  const onFaultClickRef = useRef(onFaultClick)
  useEffect(() => { onFaultClickRef.current = onFaultClick }, [onFaultClick])

  // Starfield parallax offset (fraction of λ, multiplied by parallax factor)
  const starOffsetRef = useRef(0)

  // ── Draw starfield ────────────────────────────────────────────────────────
  const drawStarfield = useCallback(() => {
    const canvas = starCanvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d'); if (!ctx) return
    const w = canvas.width, h = canvas.height
    ctx.clearRect(0, 0, w, h)

    const offsetPx = (starOffsetRef.current / 360) * w * 0.04  // 4% parallax

    for (const { nx, ny, r, opacity } of STARS) {
      const sx = ((nx * w + offsetPx) % w + w) % w
      const sy = ny * h
      ctx.beginPath()
      ctx.arc(sx, sy, r, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(255,255,255,${opacity})`
      ctx.fill()
    }
  }, [])

  // ── Draw main globe ───────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d'); if (!ctx) return
    const w = canvas.width, h = canvas.height

    // Ease zoom toward target
    const cur = scaleMultRef.current, tgt = scaleTargetRef.current
    if (Math.abs(cur - tgt) > 0.001) {
      scaleMultRef.current = cur + (tgt - cur) * 0.15
    } else {
      scaleMultRef.current = tgt
    }

    const radius   = radiusRef.current * scaleMultRef.current
    const rotation = rotationRef.current
    const cx = w / 2, cy = h / 2

    ctx.clearRect(0, 0, w, h)

    const projection = d3.geoOrthographic()
      .scale(radius).translate([cx, cy]).clipAngle(90).rotate(rotation)
    projectionRef.current = projection
    const path = d3.geoPath(projection, ctx)

    // ── 1. Outer atmospheric glow ring (amber accent, breathing) ─────────────
    const t = Date.now() / 5000                                // 5s period
    const haloOpacity = 0.15 + 0.15 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2))
    const haloGrad = ctx.createRadialGradient(cx, cy, radius * 0.95, cx, cy, radius * 1.20)
    haloGrad.addColorStop(0,   `rgba(${ACCENT_RGB.join(',')},${haloOpacity.toFixed(3)})`)
    haloGrad.addColorStop(0.5, `rgba(${ACCENT_RGB.join(',')},${(haloOpacity * 0.4).toFixed(3)})`)
    haloGrad.addColorStop(1,   'rgba(0,0,0,0)')
    ctx.beginPath()
    ctx.arc(cx, cy, radius * 1.20, 0, Math.PI * 2)
    ctx.fillStyle = haloGrad
    ctx.fill()

    // ── 2. Sphere base fill — lit hemisphere gradient (not flat) ─────────────
    // Light source upper-left: warm cream lit side, cooler at terminator
    const hlX = cx - radius * 0.30, hlY = cy - radius * 0.26
    const sphereGrad = ctx.createRadialGradient(hlX, hlY, 0, cx, cy, radius * 1.02)
    sphereGrad.addColorStop(0,    '#f2ede0')   // lit: warm cream
    sphereGrad.addColorStop(0.45, '#e8e2d4')
    sphereGrad.addColorStop(0.80, '#d4cdc0')
    sphereGrad.addColorStop(1,    '#b8b0a4')   // terminator rim: muted
    ctx.beginPath()
    path({ type: 'Sphere' } as Parameters<typeof path>[0])
    ctx.fillStyle = sphereGrad
    ctx.fill()

    // ── 3. Graticule — accent-tinted, very subtle ─────────────────────────────
    ctx.beginPath()
    path(d3.geoGraticule()())
    ctx.strokeStyle = `rgba(${ACCENT_RGB.join(',')},0.10)`
    ctx.lineWidth   = 0.4
    ctx.stroke()

    // ── 4. Land fill — warm gradient, lighter at lit pole ────────────────────
    if (landRef.current) {
      const landGrad = ctx.createRadialGradient(hlX, hlY, 0, cx, cy, radius * 1.02)
      landGrad.addColorStop(0,   '#3a3530')   // lit land: warm dark
      landGrad.addColorStop(0.7, '#2a2520')
      landGrad.addColorStop(1,   '#1e1a16')   // terminator edge: very dark

      ctx.beginPath()
      path(landRef.current as Parameters<typeof path>[0])
      ctx.fillStyle = landGrad
      ctx.fill()

      ctx.beginPath()
      path(landRef.current as Parameters<typeof path>[0])
      ctx.strokeStyle = '#141210'
      ctx.lineWidth   = 0.6
      ctx.stroke()
    }

    // ── 5. Terminator overlay — soft directional shadow ───────────────────────
    // Simple linear gradient from light-source direction to opposite
    const termGrad = ctx.createLinearGradient(
      cx - radius * 0.6, cy - radius * 0.5,   // lit corner (upper-left)
      cx + radius * 0.6, cy + radius * 0.5    // shadow corner (lower-right)
    )
    termGrad.addColorStop(0,   'rgba(0,0,0,0)')
    termGrad.addColorStop(0.6, 'rgba(0,0,0,0)')
    termGrad.addColorStop(1,   'rgba(0,0,0,0.20)')
    ctx.save()
    ctx.beginPath()
    path({ type: 'Sphere' } as Parameters<typeof path>[0])
    ctx.clip()
    ctx.fillStyle = termGrad
    ctx.fillRect(0, 0, w, h)
    ctx.restore()

    // ── 6. Fault lines — amber double-stroke glow ─────────────────────────────
    if (faultRef.current && showFaultRef.current) {
      const hov = hoveredFaultRef.current
      faultRef.current.features.forEach((feat, fi) => {
        const isHov = fi === hov
        // Glow stroke (wider, low opacity beneath)
        ctx.beginPath()
        path(feat as Parameters<typeof path>[0])
        ctx.strokeStyle = isHov
          ? `rgba(${ACCENT_RGB.join(',')},0.55)`
          : `rgba(${ACCENT_RGB.join(',')},0.20)`
        ctx.lineWidth = isHov ? 5 : 3
        ctx.setLineDash([4, 4])
        ctx.stroke()
        // Crisp stroke on top
        ctx.beginPath()
        path(feat as Parameters<typeof path>[0])
        ctx.strokeStyle = isHov
          ? `rgba(${ACCENT_RGB.join(',')},0.90)`
          : `rgba(${ACCENT_RGB.join(',')},0.42)`
        ctx.lineWidth = isHov ? 1.4 : 0.7
        ctx.setLineDash([4, 4])
        ctx.stroke()
      })
      ctx.setLineDash([])
    }

    // ── 7. Limb darkening ─────────────────────────────────────────────────────
    const limbGrad = ctx.createRadialGradient(cx, cy, radius * 0.75, cx, cy, radius)
    limbGrad.addColorStop(0, 'rgba(0,0,0,0)')
    limbGrad.addColorStop(1, 'rgba(0,0,0,0.18)')
    ctx.beginPath()
    path({ type: 'Sphere' } as Parameters<typeof path>[0])
    ctx.fillStyle = limbGrad
    ctx.fill()

    // ── 8. Sphere edge ────────────────────────────────────────────────────────
    ctx.beginPath()
    path({ type: 'Sphere' } as Parameters<typeof path>[0])
    ctx.strokeStyle = `rgba(${ACCENT_RGB.join(',')},0.14)`
    ctx.lineWidth   = 1
    ctx.stroke()

    onRotationChange([...rotation] as GeoRotation)
  }, [onRotationChange])

  // ── Draw pulse-ring overlay ───────────────────────────────────────────────
  const drawOverlay = useCallback(() => {
    const canvas = overlayCanvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d'); if (!ctx) return
    const proj = projectionRef.current; if (!proj) return
    const w = canvas.width, h = canvas.height
    const now = Date.now()

    ctx.clearRect(0, 0, w, h)

    for (const quake of earthquakesRef.current) {
      if (!isVisible(quake.longitude, quake.latitude, rotationRef.current)) continue
      const pt = proj([quake.longitude, quake.latitude]); if (!pt) continue
      const [px, py] = pt
      const r = quake.magnitude >= 6 ? 7 : quake.magnitude >= 4 ? 5 : 3.5
      const { rings, cyclems, maxOpacity, expand } = ringConfig(quake.magnitude)

      for (let i = 0; i < rings; i++) {
        const phase = ((now % cyclems) / cyclems + i / rings) % 1.0
        const ringR   = r * (1 + phase * expand)
        const opacity = (1 - phase) * maxOpacity

        ctx.beginPath()
        ctx.arc(px, py, ringR, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(${ACCENT_RGB.join(',')},${opacity.toFixed(3)})`
        ctx.lineWidth   = quake.magnitude >= 6 ? 1.5 : 1.0
        ctx.stroke()
      }
    }
  }, [])

  // ── Resize handler ────────────────────────────────────────────────────────
  const handleResize = useCallback(() => {
    const container = containerRef.current; if (!container) return
    const W = container.clientWidth, H = container.clientHeight
    ;[starCanvasRef, canvasRef, overlayCanvasRef].forEach(ref => {
      const c = ref.current; if (!c) return
      c.width = W; c.height = H
    })
    radiusRef.current = (Math.min(W, H) / 2) * 0.92
    drawStarfield()
    draw()
  }, [draw, drawStarfield])

  // ── Data fetches ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (landLoadedRef.current) return; landLoadedRef.current = true
    fetch(LAND_URL).then(r => r.json()).then((g: GeoFeatureCollection) => {
      landRef.current = g; draw()
    }).catch(console.error)
  }, [draw])

  useEffect(() => {
    if (faultLoadedRef.current) return; faultLoadedRef.current = true
    fetch(FAULT_URL).then(r => r.json()).then((g: GeoFeatureCollection) => {
      faultRef.current = g; draw()
    }).catch(console.error)
  }, [draw])

  // ── Mount: resize observer ────────────────────────────────────────────────
  useEffect(() => {
    handleResize()
    const obs = new ResizeObserver(handleResize)
    if (containerRef.current) obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [handleResize])

  // ── Globe animation loop ──────────────────────────────────────────────────
  useEffect(() => {
    if (reducedMotion) { draw(); return }

    globeTimerRef.current = d3.timer(() => {
      // Inertia coasting
      if (coastingRef.current) {
        rotationRef.current[0] = (rotationRef.current[0] + inertiaRef.current) % 360
        inertiaRef.current *= 0.92
        if (Math.abs(inertiaRef.current) < 0.03) {
          coastingRef.current = false
          // Resume auto-rotate after coasting ends
          if (dragEndTimerRef.current) clearTimeout(dragEndTimerRef.current)
          dragEndTimerRef.current = setTimeout(() => { autoRotateRef.current = true }, 800)
        }
        draw()
      } else if (autoRotateRef.current) {
        rotationRef.current[0] = (rotationRef.current[0] + ROTATION_SPEED) % 360
        draw()
      } else {
        // Still need to run draw for eased zoom even when not rotating
        const diff = Math.abs(scaleMultRef.current - scaleTargetRef.current)
        if (diff > 0.001) draw()
      }
    })

    return () => { globeTimerRef.current?.stop() }
  }, [reducedMotion, draw])

  // ── Overlay pulse-ring loop (independent, never stutters) ────────────────
  useEffect(() => {
    if (reducedMotion) return

    overlayTimerRef.current = d3.timer(() => {
      drawOverlay()
    })
    return () => { overlayTimerRef.current?.stop() }
  }, [reducedMotion, drawOverlay])

  // ── Starfield redraw when fault lines toggle (forces a redraw pass) ───────
  useEffect(() => {
    drawStarfield()
  }, [drawStarfield])

  // ── Mouse + touch interactions ────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return

    const onMouseDown = (e: MouseEvent) => {
      if (dragEndTimerRef.current) clearTimeout(dragEndTimerRef.current)
      autoRotateRef.current  = false
      coastingRef.current    = false
      draggingRef.current    = true
      velBufRef.current      = []
      dragStartRotRef.current = [...rotationRef.current] as GeoRotation
      dragStartPosRef.current = [e.clientX, e.clientY]
    }

    let lastDragX = 0, lastDragTime = 0
    const onMouseMove = (e: MouseEvent) => {
      if (draggingRef.current) {
        const dx = e.clientX - dragStartPosRef.current[0]
        const dy = e.clientY - dragStartPosRef.current[1]
        const sens = 0.3
        rotationRef.current = [
          dragStartRotRef.current[0] + dx * sens,
          Math.max(-90, Math.min(90, dragStartRotRef.current[1] - dy * sens)),
          dragStartRotRef.current[2],
        ]
        // Track velocity for inertia
        const now = performance.now()
        if (lastDragTime > 0) {
          const dt  = now - lastDragTime
          const vel = (e.clientX - lastDragX) * sens / (dt / 16.67)  // normalised to 60fps
          velBufRef.current.push(vel)
          if (velBufRef.current.length > 5) velBufRef.current.shift()
        }
        lastDragX = e.clientX; lastDragTime = performance.now()

        // Starfield parallax: offset by drag delta × 0.04
        starOffsetRef.current = rotationRef.current[0]
        drawStarfield()
        draw()
        return
      }

      // Fault hover detection
      const faults = faultRef.current; const proj = projectionRef.current
      if (!faults || !proj || !showFaultRef.current) {
        if (hoveredFaultRef.current !== -1) { hoveredFaultRef.current = -1; draw(); onFaultHoverRef.current(null,0,0) }
        return
      }
      const rect = canvas.getBoundingClientRect()
      const sx = canvas.width / rect.width, sy = canvas.height / rect.height
      const cx = (e.clientX - rect.left) * sx, cy2 = (e.clientY - rect.top) * sy
      const fi = findHoveredFault(cx, cy2, faults.features, proj)
      if (fi !== hoveredFaultRef.current) {
        hoveredFaultRef.current = fi; draw()
        if (fi >= 0) {
          const f = faults.features[fi]
          const raw = String(f.properties?.Type ?? '').toLowerCase()
          const geo = proj.invert?.([cx, cy2])
          onFaultHoverRef.current({ boundaryType: raw, rawType: String(f.properties?.Type ?? ''), clickLat: geo?.[1] ?? 0, clickLng: geo?.[0] ?? 0 }, e.clientX, e.clientY)
        } else {
          onFaultHoverRef.current(null, 0, 0)
        }
      }
    }

    const onMouseUp = () => {
      const wasDragging = draggingRef.current
      draggingRef.current = false
      if (!wasDragging) return

      // Inertia: average velocity buffer
      const vels = velBufRef.current
      if (vels.length > 0) {
        const avgVel = vels.reduce((a,b) => a+b, 0) / vels.length
        if (Math.abs(avgVel) > 0.1) {
          inertiaRef.current = avgVel
          coastingRef.current = true
          return  // coasting handler resumes auto-rotate when done
        }
      }
      // No meaningful velocity: 2s pause then resume
      if (dragEndTimerRef.current) clearTimeout(dragEndTimerRef.current)
      dragEndTimerRef.current = setTimeout(() => { autoRotateRef.current = true }, 2000)
    }

    const onMouseLeave = () => {
      if (hoveredFaultRef.current !== -1) { hoveredFaultRef.current = -1; draw(); onFaultHoverRef.current(null,0,0) }
    }

    const onClick = (e: MouseEvent) => {
      if (draggingRef.current) return
      const faults = faultRef.current; const proj = projectionRef.current
      if (!faults || !proj || !showFaultRef.current) return
      const rect = canvas.getBoundingClientRect()
      const sx = canvas.width / rect.width, sy = canvas.height / rect.height
      const cx = (e.clientX - rect.left) * sx, cy2 = (e.clientY - rect.top) * sy
      const fi = findHoveredFault(cx, cy2, faults.features, proj)
      if (fi >= 0) {
        const f = faults.features[fi]
        const raw = String(f.properties?.Type ?? '').toLowerCase()
        const geo = proj.invert?.([cx, cy2])
        onFaultClickRef.current({ boundaryType: raw, rawType: String(f.properties?.Type ?? ''), clickLat: geo?.[1] ?? 0, clickLng: geo?.[0] ?? 0 })
      }
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const factor = e.deltaY > 0 ? 0.92 : 1.08
      scaleTargetRef.current = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scaleTargetRef.current * factor))
    }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      if (dragEndTimerRef.current) clearTimeout(dragEndTimerRef.current)
      autoRotateRef.current = false; coastingRef.current = false; draggingRef.current = true
      velBufRef.current = []
      dragStartRotRef.current = [...rotationRef.current] as GeoRotation
      dragStartPosRef.current = [e.touches[0].clientX, e.touches[0].clientY]
    }
    const onTouchMove = (e: TouchEvent) => {
      if (!draggingRef.current || e.touches.length !== 1) return
      const dx = e.touches[0].clientX - dragStartPosRef.current[0]
      const dy = e.touches[0].clientY - dragStartPosRef.current[1]
      const sens = 0.3
      rotationRef.current = [
        dragStartRotRef.current[0] + dx * sens,
        Math.max(-90, Math.min(90, dragStartRotRef.current[1] - dy * sens)),
        dragStartRotRef.current[2],
      ]
      starOffsetRef.current = rotationRef.current[0]
      drawStarfield(); draw()
    }
    const onTouchEnd = () => {
      draggingRef.current = false
      if (dragEndTimerRef.current) clearTimeout(dragEndTimerRef.current)
      dragEndTimerRef.current = setTimeout(() => { autoRotateRef.current = true }, 2000)
    }

    canvas.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup',   onMouseUp)
    canvas.addEventListener('mouseleave', onMouseLeave)
    canvas.addEventListener('click',     onClick)
    canvas.addEventListener('wheel',     onWheel, { passive: false })
    canvas.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove',  onTouchMove,  { passive: true })
    window.addEventListener('touchend',   onTouchEnd)

    return () => {
      canvas.removeEventListener('mousedown',  onMouseDown)
      window.removeEventListener('mousemove',  onMouseMove)
      window.removeEventListener('mouseup',    onMouseUp)
      canvas.removeEventListener('mouseleave', onMouseLeave)
      canvas.removeEventListener('click',      onClick)
      canvas.removeEventListener('wheel',      onWheel)
      canvas.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove',  onTouchMove)
      window.removeEventListener('touchend',   onTouchEnd)
    }
  }, [draw, drawStarfield])

  useImperativeHandle(ref, () => ({
    getRotation:   () => rotationRef.current,
    getProjection: () => projectionRef.current,
    getRadius:     () => radiusRef.current * scaleMultRef.current,
  }))

  return (
    <div ref={containerRef} style={{ position: 'absolute', inset: 0, cursor: 'grab' }}>
      {/* Layer 0: starfield — redraws slowly, parallax on drag */}
      <canvas ref={starCanvasRef} style={{ position: 'absolute', inset: 0, display: 'block', width: '100%', height: '100%', zIndex: 0 }} />
      {/* Layer 1: main globe — land, faults, graticule, halo */}
      <canvas ref={canvasRef}     style={{ position: 'absolute', inset: 0, display: 'block', width: '100%', height: '100%', zIndex: 1 }} />
      {/* Layer 2: overlay — sonar pulse rings (independent rAF) */}
      <canvas ref={overlayCanvasRef} style={{ position: 'absolute', inset: 0, display: 'block', width: '100%', height: '100%', zIndex: 2, pointerEvents: 'none' }} />
    </div>
  )
})

EarthGlobe.displayName = 'EarthGlobe'
