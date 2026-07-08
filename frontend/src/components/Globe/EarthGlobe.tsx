import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'
import * as d3 from 'd3'
import type { GeoRotation } from './globeProjection'

// ─── Constants ───────────────────────────────────────────────────────────────

const LAND_GEOJSON_URL =
  'https://raw.githubusercontent.com/martynafford/natural-earth-geojson/refs/heads/master/110m/physical/ne_110m_land.json'

const ROTATION_SPEED = 0.35  // degrees per frame
const MIN_SCALE = 0.5
const MAX_SCALE = 3.0

// ─── Types ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GeoFeature = { type: string; geometry: { type: string; coordinates: any }; properties: Record<string, unknown> }
type GeoFeatureCollection = { type: string; features: GeoFeature[] }

export interface EarthGlobeHandle {
  getRotation: () => GeoRotation
  getProjection: () => d3.GeoProjection | null
  getRadius: () => number
}

interface EarthGlobeProps {
  /** Called every draw frame with the current [λ, φ, γ] rotation */
  onRotationChange: (rotation: GeoRotation) => void
  /** Disable auto-rotation and ripples (prefers-reduced-motion) */
  reducedMotion: boolean
}

// ─── Component ───────────────────────────────────────────────────────────────

export const EarthGlobe = forwardRef<EarthGlobeHandle, EarthGlobeProps>(
  ({ onRotationChange, reducedMotion }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)

    // Globe state — all in refs to avoid React re-renders in the animation loop
    const rotationRef = useRef<GeoRotation>([0, -25, 0])
    const scaleMultRef = useRef(1)
    const projectionRef = useRef<d3.GeoProjection | null>(null)
    const radiusRef = useRef(300)

    // Land GeoJSON — stored once on load, re-projected every frame via d3.geoPath()
    const landGeoJSONRef = useRef<GeoFeatureCollection | null>(null)
    const geoLoadedRef = useRef(false)

    // Animation state
    const timerRef = useRef<d3.Timer | null>(null)
    const draggingRef = useRef(false)
    const dragStartRotRef = useRef<GeoRotation>([0, -25, 0])
    const dragStartPosRef = useRef<[number, number]>([0, 0])

    // ── Draw loop ────────────────────────────────────────────────────────────
    const draw = useCallback(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const w = canvas.width
      const h = canvas.height
      const baseRadius = radiusRef.current
      const radius = baseRadius * scaleMultRef.current
      const rotation = rotationRef.current

      ctx.clearRect(0, 0, w, h)

      // Build projection for this frame
      const projection = d3
        .geoOrthographic()
        .scale(radius)
        .translate([w / 2, h / 2])
        .clipAngle(90)
        .rotate(rotation)

      projectionRef.current = projection
      const path = d3.geoPath(projection, ctx)

      const cx = w / 2
      const cy = h / 2

      // ── 1. Atmospheric glow — soft outer ring so globe doesn't look pasted ──
      const glowGrad = ctx.createRadialGradient(cx, cy, radius * 0.94, cx, cy, radius * 1.14)
      glowGrad.addColorStop(0, 'rgba(200,195,185,0.20)')
      glowGrad.addColorStop(0.6, 'rgba(200,195,185,0.08)')
      glowGrad.addColorStop(1, 'rgba(200,195,185,0)')
      ctx.beginPath()
      ctx.arc(cx, cy, radius * 1.14, 0, Math.PI * 2)
      ctx.fillStyle = glowGrad
      ctx.fill()

      // ── 2. Sphere fill — off-centre radial gradient (warm parchment) ──────
      // Light source at ~(35%, 30%) of sphere diameter — upper-left highlight.
      const highlightX = cx - radius * 0.32
      const highlightY = cy - radius * 0.28
      const grad = ctx.createRadialGradient(
        highlightX, highlightY, 0,
        cx, cy, radius * 1.02,
      )
      grad.addColorStop(0,    '#f2efe9')
      grad.addColorStop(0.40, '#eae5dc')
      grad.addColorStop(0.75, '#dbd5c9')
      grad.addColorStop(1,    '#c8c2b5')

      ctx.beginPath()
      path({ type: 'Sphere' } as Parameters<typeof path>[0])
      ctx.fillStyle = grad
      ctx.fill()

      // ── 3. Graticule — drawn BEFORE land so land occludes it naturally ────
      // Thin lines are visible only over ocean; continent fill covers them.
      const graticule = d3.geoGraticule()()
      ctx.beginPath()
      path(graticule)
      ctx.strokeStyle = 'rgba(180,175,165,0.35)'
      ctx.lineWidth = 0.5
      ctx.stroke()

      // ── 4. Land fill — solid continent silhouettes ────────────────────────
      // d3.geoPath() with the orthographic projection correctly clips to the
      // visible hemisphere and renders geodesic edges — no dot approximation needed.
      const landGeoJSON = landGeoJSONRef.current
      if (landGeoJSON) {
        // Solid fill: warm dark charcoal, not pure black
        ctx.beginPath()
        path(landGeoJSON as Parameters<typeof path>[0])
        ctx.fillStyle = '#2a2620'
        ctx.fill()

        // Subtle 1px stroke along coastlines for definition
        ctx.beginPath()
        path(landGeoJSON as Parameters<typeof path>[0])
        ctx.strokeStyle = '#1a1814'
        ctx.lineWidth = 0.75
        ctx.stroke()
      }

      // ── 5. Limb darkening — inner shadow at sphere edge (adds sphericality) ──
      const limbGrad = ctx.createRadialGradient(cx, cy, radius * 0.80, cx, cy, radius)
      limbGrad.addColorStop(0, 'rgba(0,0,0,0)')
      limbGrad.addColorStop(1, 'rgba(0,0,0,0.12)')
      ctx.beginPath()
      path({ type: 'Sphere' } as Parameters<typeof path>[0])
      ctx.fillStyle = limbGrad
      ctx.fill()

      // ── 6. Sphere edge stroke — clean terminator line ────────────────────
      ctx.beginPath()
      path({ type: 'Sphere' } as Parameters<typeof path>[0])
      ctx.strokeStyle = 'rgba(140,134,124,0.35)'
      ctx.lineWidth = 0.75
      ctx.stroke()

      // Notify parent every frame (used by QuakeMarkers to re-project)
      onRotationChange([...rotation] as GeoRotation)
    }, [onRotationChange])

    // ── Resize handler ───────────────────────────────────────────────────────
    const handleResize = useCallback(() => {
      const container = containerRef.current
      const canvas = canvasRef.current
      if (!container || !canvas) return
      canvas.width = container.clientWidth
      canvas.height = container.clientHeight
      // Recalculate base radius from container
      radiusRef.current =
        (Math.min(container.clientWidth, container.clientHeight) / 2) * 0.92
      draw()
    }, [draw])

    // ── GeoJSON load (once on mount) ─────────────────────────────────────────
    useEffect(() => {
      if (geoLoadedRef.current) return
      geoLoadedRef.current = true

      fetch(LAND_GEOJSON_URL)
        .then((r) => r.json())
        .then((geojson: GeoFeatureCollection) => {
          landGeoJSONRef.current = geojson
          draw() // redraw immediately with land
        })
        .catch(console.error)
    }, [draw])

    // ── Mount: ResizeObserver + initial draw ─────────────────────────────────
    useEffect(() => {
      handleResize()
      const observer = new ResizeObserver(handleResize)
      if (containerRef.current) observer.observe(containerRef.current)
      return () => observer.disconnect()
    }, [handleResize])

    // ── Auto-rotation timer ───────────────────────────────────────────────────
    useEffect(() => {
      if (reducedMotion) {
        draw()
        return
      }

      timerRef.current = d3.timer(() => {
        if (!draggingRef.current) {
          rotationRef.current[0] = (rotationRef.current[0] + ROTATION_SPEED) % 360
          draw()
        }
      })

      return () => {
        timerRef.current?.stop()
      }
    }, [reducedMotion, draw])

    // ── Mouse drag ───────────────────────────────────────────────────────────
    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return

      const onMouseDown = (e: MouseEvent) => {
        draggingRef.current = true
        dragStartRotRef.current = [...rotationRef.current] as GeoRotation
        dragStartPosRef.current = [e.clientX, e.clientY]
      }

      const onMouseMove = (e: MouseEvent) => {
        if (!draggingRef.current) return
        const dx = e.clientX - dragStartPosRef.current[0]
        const dy = e.clientY - dragStartPosRef.current[1]
        const sens = 0.3
        rotationRef.current = [
          dragStartRotRef.current[0] + dx * sens,
          Math.max(-90, Math.min(90, dragStartRotRef.current[1] - dy * sens)),
          dragStartRotRef.current[2],
        ]
        draw()
      }

      const onMouseUp = () => { draggingRef.current = false }

      const onWheel = (e: WheelEvent) => {
        e.preventDefault()
        const factor = e.deltaY > 0 ? 0.92 : 1.08
        scaleMultRef.current = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scaleMultRef.current * factor))
        draw()
      }

      // Touch drag
      const onTouchStart = (e: TouchEvent) => {
        if (e.touches.length === 1) {
          draggingRef.current = true
          dragStartRotRef.current = [...rotationRef.current] as GeoRotation
          dragStartPosRef.current = [e.touches[0].clientX, e.touches[0].clientY]
        }
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
        draw()
      }
      const onTouchEnd = () => { draggingRef.current = false }

      canvas.addEventListener('mousedown', onMouseDown)
      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)
      canvas.addEventListener('wheel', onWheel, { passive: false })
      canvas.addEventListener('touchstart', onTouchStart, { passive: true })
      window.addEventListener('touchmove', onTouchMove, { passive: true })
      window.addEventListener('touchend', onTouchEnd)

      return () => {
        canvas.removeEventListener('mousedown', onMouseDown)
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', onMouseUp)
        canvas.removeEventListener('wheel', onWheel)
        canvas.removeEventListener('touchstart', onTouchStart)
        window.removeEventListener('touchmove', onTouchMove)
        window.removeEventListener('touchend', onTouchEnd)
      }
    }, [draw])

    // ── Imperative handle for parent to read live state ──────────────────────
    useImperativeHandle(ref, () => ({
      getRotation: () => rotationRef.current,
      getProjection: () => projectionRef.current,
      getRadius: () => radiusRef.current * scaleMultRef.current,
    }))

    return (
      <div
        ref={containerRef}
        style={{ position: 'absolute', inset: 0, cursor: 'grab' }}
      >
        <canvas
          ref={canvasRef}
          style={{ display: 'block', width: '100%', height: '100%' }}
        />
      </div>
    )
  },
)

EarthGlobe.displayName = 'EarthGlobe'
