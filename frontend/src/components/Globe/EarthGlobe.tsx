import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'
import * as d3 from 'd3'
import type { GeoRotation } from './globeProjection'

// ─── Constants ───────────────────────────────────────────────────────────────

const LAND_GEOJSON_URL =
  'https://raw.githubusercontent.com/martynafford/natural-earth-geojson/refs/heads/master/110m/physical/ne_110m_land.json'

const FAULT_GEOJSON_URL =
  'https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json'

const ROTATION_SPEED = 0.06    // degrees per frame — slow meditative drift
const MIN_SCALE = 0.5
const MAX_SCALE = 3.0
const FAULT_HIT_PX = 8         // pixel radius for fault line hover/click detection
const FAULT_SAMPLE_STEP = 5    // sample every Nth point of each segment for perf

// ─── Fault line visual styles ─────────────────────────────────────────────────

const BOUNDARY_COLORS: Record<string, string> = {
  subduction: 'rgba(220, 60, 40, 0.4)',
  transform:  'rgba(220, 140, 30, 0.35)',
  spreading:  'rgba(60, 140, 200, 0.3)',
  default:    'rgba(150, 100, 60, 0.25)',
}

const BOUNDARY_COLORS_HOVER: Record<string, string> = {
  subduction: 'rgba(220, 60, 40, 0.85)',
  transform:  'rgba(220, 140, 30, 0.85)',
  spreading:  'rgba(60, 140, 200, 0.85)',
  default:    'rgba(150, 100, 60, 0.85)',
}

const BOUNDARY_DASH: Record<string, number[]> = {
  subduction: [4, 3],
  transform:  [2, 4],
  spreading:  [6, 3],
  default:    [3, 4],
}

// ─── Types ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GeoFeature = { type: string; geometry: { type: string; coordinates: any }; properties: Record<string, unknown> }
type GeoFeatureCollection = { type: string; features: GeoFeature[] }

export interface FaultFeature {
  boundaryType: string      // 'subduction' | 'transform' | 'spreading' | 'default'
  rawType: string           // raw value from GeoJSON properties.Type
  clickLat: number
  clickLng: number
}

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
  /** Whether to render fault lines */
  showFaultLines: boolean
  /** Called when mouse hovers near a fault line (null = left) */
  onFaultHover: (fault: FaultFeature | null, x: number, y: number) => void
  /** Called when user clicks a fault line segment */
  onFaultClick: (fault: FaultFeature) => void
}

// ─── Fault line hit-detection helper ─────────────────────────────────────────

/**
 * Given a projected [x,y] canvas point and a list of projected fault line
 * segments, return the index of the first feature within FAULT_HIT_PX pixels,
 * or -1 if none. Samples every FAULT_SAMPLE_STEP-th coordinate for performance.
 */
function findHoveredFault(
  mouseX: number,
  mouseY: number,
  faultFeatures: GeoFeature[],
  projection: d3.GeoProjection,
): number {
  const threshold2 = FAULT_HIT_PX * FAULT_HIT_PX

  for (let fi = 0; fi < faultFeatures.length; fi++) {
    const geom = faultFeatures[fi].geometry
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const coords: [number, number][] =
      geom.type === 'LineString'
        ? (geom.coordinates as [number, number][])
        : geom.type === 'MultiLineString'
          ? (geom.coordinates as [number, number][][]).flat()
          : []

    for (let ci = 0; ci < coords.length; ci += FAULT_SAMPLE_STEP) {
      const pt = projection(coords[ci])
      if (!pt) continue
      const dx = pt[0] - mouseX
      const dy = pt[1] - mouseY
      if (dx * dx + dy * dy <= threshold2) return fi
    }
  }
  return -1
}

/**
 * Unproject a canvas pixel back to [lng, lat] using the current projection.
 * Returns null if the point is outside the globe sphere.
 */
function canvasToGeo(
  x: number,
  y: number,
  projection: d3.GeoProjection,
): [number, number] | null {
  const inv = projection.invert?.([x, y])
  return inv ? [inv[0], inv[1]] : null
}

// ─── Component ───────────────────────────────────────────────────────────────

export const EarthGlobe = forwardRef<EarthGlobeHandle, EarthGlobeProps>(
  ({ onRotationChange, reducedMotion, showFaultLines, onFaultHover, onFaultClick }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)

    // Globe state — all in refs to avoid React re-renders in the animation loop
    const rotationRef = useRef<GeoRotation>([0, -25, 0])
    const scaleMultRef = useRef(1)
    const projectionRef = useRef<d3.GeoProjection | null>(null)
    const radiusRef = useRef(300)

    // GeoJSON data — fetched once, cached in refs
    const landGeoJSONRef = useRef<GeoFeatureCollection | null>(null)
    const faultLinesRef = useRef<GeoFeatureCollection | null>(null)
    const geoLoadedRef = useRef(false)
    const faultLoadedRef = useRef(false)

    // Fault hover state — ref (not React state) to avoid re-render on every mousemove
    const hoveredFaultIndexRef = useRef(-1)

    // Props in refs so draw() callback doesn't go stale
    const showFaultLinesRef = useRef(showFaultLines)
    useEffect(() => { showFaultLinesRef.current = showFaultLines }, [showFaultLines])
    const onFaultHoverRef = useRef(onFaultHover)
    useEffect(() => { onFaultHoverRef.current = onFaultHover }, [onFaultHover])
    const onFaultClickRef = useRef(onFaultClick)
    useEffect(() => { onFaultClickRef.current = onFaultClick }, [onFaultClick])

    // Animation state
    const timerRef = useRef<d3.Timer | null>(null)
    const autoRotateRef = useRef(true)          // false while dragging + 2s after
    const draggingRef = useRef(false)
    const dragEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
      const graticule = d3.geoGraticule()()
      ctx.beginPath()
      path(graticule)
      ctx.strokeStyle = 'rgba(180,175,165,0.35)'
      ctx.lineWidth = 0.5
      ctx.stroke()

      // ── 4. Land fill — solid continent silhouettes ────────────────────────
      const landGeoJSON = landGeoJSONRef.current
      if (landGeoJSON) {
        ctx.beginPath()
        path(landGeoJSON as Parameters<typeof path>[0])
        ctx.fillStyle = '#2a2620'
        ctx.fill()

        ctx.beginPath()
        path(landGeoJSON as Parameters<typeof path>[0])
        ctx.strokeStyle = '#1a1814'
        ctx.lineWidth = 0.75
        ctx.stroke()
      }

      // ── 5. Fault lines — drawn after land so they're visible on oceans ────
      //       and also show through on land (thin enough to read over dark fill)
      const faultLines = faultLinesRef.current
      if (faultLines && showFaultLinesRef.current) {
        const hovIdx = hoveredFaultIndexRef.current
        faultLines.features.forEach((feature, fi) => {
          const rawType = String(feature.properties?.Type ?? '').toLowerCase()
          const isHovered = fi === hovIdx
          const color = isHovered
            ? (BOUNDARY_COLORS_HOVER[rawType] ?? BOUNDARY_COLORS_HOVER.default)
            : (BOUNDARY_COLORS[rawType] ?? BOUNDARY_COLORS.default)
          const dash = BOUNDARY_DASH[rawType] ?? BOUNDARY_DASH.default

          ctx.beginPath()
          path(feature as Parameters<typeof path>[0])
          ctx.strokeStyle = color
          ctx.lineWidth = isHovered ? 1.8 : 0.8
          ctx.setLineDash(dash)
          ctx.stroke()
        })
        ctx.setLineDash([])
      }

      // ── 6. Limb darkening — inner shadow at sphere edge ───────────────────
      const limbGrad = ctx.createRadialGradient(cx, cy, radius * 0.80, cx, cy, radius)
      limbGrad.addColorStop(0, 'rgba(0,0,0,0)')
      limbGrad.addColorStop(1, 'rgba(0,0,0,0.12)')
      ctx.beginPath()
      path({ type: 'Sphere' } as Parameters<typeof path>[0])
      ctx.fillStyle = limbGrad
      ctx.fill()

      // ── 7. Sphere edge stroke — clean terminator line ─────────────────────
      ctx.beginPath()
      path({ type: 'Sphere' } as Parameters<typeof path>[0])
      ctx.strokeStyle = 'rgba(140,134,124,0.35)'
      ctx.lineWidth = 0.75
      ctx.stroke()

      onRotationChange([...rotation] as GeoRotation)
    }, [onRotationChange])

    // ── Resize handler ───────────────────────────────────────────────────────
    const handleResize = useCallback(() => {
      const container = containerRef.current
      const canvas = canvasRef.current
      if (!container || !canvas) return
      canvas.width = container.clientWidth
      canvas.height = container.clientHeight
      radiusRef.current =
        (Math.min(container.clientWidth, container.clientHeight) / 2) * 0.92
      draw()
    }, [draw])

    // ── GeoJSON loads (once on mount) ────────────────────────────────────────
    useEffect(() => {
      if (geoLoadedRef.current) return
      geoLoadedRef.current = true
      fetch(LAND_GEOJSON_URL)
        .then((r) => r.json())
        .then((geojson: GeoFeatureCollection) => {
          landGeoJSONRef.current = geojson
          draw()
        })
        .catch(console.error)
    }, [draw])

    useEffect(() => {
      if (faultLoadedRef.current) return
      faultLoadedRef.current = true
      fetch(FAULT_GEOJSON_URL)
        .then((r) => r.json())
        .then((geojson: GeoFeatureCollection) => {
          faultLinesRef.current = geojson
          draw()
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
        if (autoRotateRef.current) {
          rotationRef.current[0] = (rotationRef.current[0] + ROTATION_SPEED) % 360
          draw()
        }
      })

      return () => {
        timerRef.current?.stop()
      }
    }, [reducedMotion, draw])

    // ── Mouse interactions ────────────────────────────────────────────────────
    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return

      const onMouseDown = (e: MouseEvent) => {
        if (dragEndTimerRef.current) clearTimeout(dragEndTimerRef.current)
        autoRotateRef.current = false
        draggingRef.current = true
        dragStartRotRef.current = [...rotationRef.current] as GeoRotation
        dragStartPosRef.current = [e.clientX, e.clientY]
      }

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
          draw()
          return
        }

        // Fault line hover detection (only when not dragging)
        const faultLines = faultLinesRef.current
        const projection = projectionRef.current
        if (!faultLines || !projection || !showFaultLinesRef.current) {
          if (hoveredFaultIndexRef.current !== -1) {
            hoveredFaultIndexRef.current = -1
            draw()
            onFaultHoverRef.current(null, e.clientX, e.clientY)
          }
          return
        }

        const rect = canvas.getBoundingClientRect()
        const scaleX = canvas.width / rect.width
        const scaleY = canvas.height / rect.height
        const canvasX = (e.clientX - rect.left) * scaleX
        const canvasY = (e.clientY - rect.top) * scaleY

        const fi = findHoveredFault(canvasX, canvasY, faultLines.features, projection)

        if (fi !== hoveredFaultIndexRef.current) {
          hoveredFaultIndexRef.current = fi
          draw()

          if (fi >= 0) {
            const feature = faultLines.features[fi]
            const rawType = String(feature.properties?.Type ?? '').toLowerCase()
            const boundaryType = BOUNDARY_COLORS[rawType] ? rawType : 'default'
            const geo = canvasToGeo(canvasX, canvasY, projection)
            onFaultHoverRef.current(
              {
                boundaryType,
                rawType: String(feature.properties?.Type ?? ''),
                clickLat: geo ? geo[1] : 0,
                clickLng: geo ? geo[0] : 0,
              },
              e.clientX,
              e.clientY,
            )
          } else {
            onFaultHoverRef.current(null, e.clientX, e.clientY)
          }
        }
      }

      const onMouseUp = () => {
        draggingRef.current = false
        if (dragEndTimerRef.current) clearTimeout(dragEndTimerRef.current)
        dragEndTimerRef.current = setTimeout(() => {
          autoRotateRef.current = true
        }, 2000)
      }

      const onMouseLeave = () => {
        if (hoveredFaultIndexRef.current !== -1) {
          hoveredFaultIndexRef.current = -1
          draw()
          onFaultHoverRef.current(null, 0, 0)
        }
      }

      // Click: fault line detection (quake marker clicks happen in the SVG overlay)
      const onClick = (e: MouseEvent) => {
        if (draggingRef.current) return
        const faultLines = faultLinesRef.current
        const projection = projectionRef.current
        if (!faultLines || !projection || !showFaultLinesRef.current) return

        const rect = canvas.getBoundingClientRect()
        const scaleX = canvas.width / rect.width
        const scaleY = canvas.height / rect.height
        const canvasX = (e.clientX - rect.left) * scaleX
        const canvasY = (e.clientY - rect.top) * scaleY

        const fi = findHoveredFault(canvasX, canvasY, faultLines.features, projection)
        if (fi >= 0) {
          const feature = faultLines.features[fi]
          const rawType = String(feature.properties?.Type ?? '').toLowerCase()
          const boundaryType = BOUNDARY_COLORS[rawType] ? rawType : 'default'
          const geo = canvasToGeo(canvasX, canvasY, projection)
          onFaultClickRef.current({
            boundaryType,
            rawType: String(feature.properties?.Type ?? ''),
            clickLat: geo ? geo[1] : 0,
            clickLng: geo ? geo[0] : 0,
          })
        }
      }

      const onWheel = (e: WheelEvent) => {
        e.preventDefault()
        const factor = e.deltaY > 0 ? 0.92 : 1.08
        scaleMultRef.current = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scaleMultRef.current * factor))
        draw()
      }

      // Touch drag
      const onTouchStart = (e: TouchEvent) => {
        if (e.touches.length === 1) {
          if (dragEndTimerRef.current) clearTimeout(dragEndTimerRef.current)
          autoRotateRef.current = false
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
      const onTouchEnd = () => {
        draggingRef.current = false
        if (dragEndTimerRef.current) clearTimeout(dragEndTimerRef.current)
        dragEndTimerRef.current = setTimeout(() => {
          autoRotateRef.current = true
        }, 2000)
      }

      canvas.addEventListener('mousedown', onMouseDown)
      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)
      canvas.addEventListener('mouseleave', onMouseLeave)
      canvas.addEventListener('click', onClick)
      canvas.addEventListener('wheel', onWheel, { passive: false })
      canvas.addEventListener('touchstart', onTouchStart, { passive: true })
      window.addEventListener('touchmove', onTouchMove, { passive: true })
      window.addEventListener('touchend', onTouchEnd)

      return () => {
        canvas.removeEventListener('mousedown', onMouseDown)
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', onMouseUp)
        canvas.removeEventListener('mouseleave', onMouseLeave)
        canvas.removeEventListener('click', onClick)
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
