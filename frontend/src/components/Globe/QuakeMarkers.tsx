import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import * as d3 from 'd3'
import type { Earthquake } from '../../lib/types'
import type { GeoRotation } from './globeProjection'
import { isVisible } from './globeProjection'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getMagnitudeColor(mag: number): string {
  if (mag >= 6) return '#c0392b'
  if (mag >= 4) return '#ef9f27'
  return '#639922'
}

function getMagnitudeRadius(mag: number): number {
  if (mag >= 6) return 7
  if (mag >= 4) return 5
  return 3.5
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface MarkerData {
  id:       string
  x:        number
  y:        number
  quake:    Earthquake
}

interface QuakeMarkersProps {
  earthquakes:   Earthquake[]
  rotationRef:   React.RefObject<GeoRotation>
  projectionRef: React.RefObject<d3.GeoProjection | null>
  selectedId:    string | null
  onSelect:      (quake: Earthquake) => void
  reducedMotion: boolean
}

// ─── Component ───────────────────────────────────────────────────────────────
// Note: pulse rings are rendered on the overlay canvas inside EarthGlobe.
// This SVG layer handles click targets + dot visuals + selection rings.

export function QuakeMarkers({
  earthquakes,
  rotationRef,
  projectionRef,
  selectedId,
  onSelect,
  reducedMotion,
}: QuakeMarkersProps) {
  const [markers, setMarkers] = useState<MarkerData[]>([])
  const rafRef       = useRef<number | null>(null)
  const lastRef      = useRef(0)

  const update = useCallback((ts: number) => {
    if (ts - lastRef.current >= 33) {       // ~30fps throttle
      lastRef.current = ts
      const rot  = rotationRef.current
      const proj = projectionRef.current
      if (rot && proj) {
        const next: MarkerData[] = []
        for (const q of earthquakes) {
          if (!isVisible(q.longitude, q.latitude, rot)) continue
          const pt = proj([q.longitude, q.latitude]); if (!pt) continue
          next.push({ id: q.id, x: pt[0], y: pt[1], quake: q })
        }
        setMarkers(next)
      }
    }
    rafRef.current = requestAnimationFrame(update)
  }, [earthquakes, rotationRef, projectionRef])

  useEffect(() => {
    rafRef.current = requestAnimationFrame(update)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [update])

  return (
    <svg
      style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        pointerEvents: 'none', overflow: 'visible', zIndex: 10,
      }}
      aria-label="Earthquake markers on globe"
    >
      <defs>
        {/* Per-color drop-shadow glow filters — magnitude dot only */}
        <filter id="glow-red"   x="-70%" y="-70%" width="240%" height="240%">
          <feGaussianBlur stdDeviation="3.5" result="blur" />
          <feFlood floodColor="#c0392b" floodOpacity="0.6" result="color" />
          <feComposite in="color" in2="blur" operator="in" result="shadow" />
          <feMerge><feMergeNode in="shadow" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="glow-amber" x="-70%" y="-70%" width="240%" height="240%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feFlood floodColor="#ef9f27" floodOpacity="0.55" result="color" />
          <feComposite in="color" in2="blur" operator="in" result="shadow" />
          <feMerge><feMergeNode in="shadow" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="glow-green" x="-70%" y="-70%" width="240%" height="240%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feFlood floodColor="#639922" floodOpacity="0.5" result="color" />
          <feComposite in="color" in2="blur" operator="in" result="shadow" />
          <feMerge><feMergeNode in="shadow" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        {/* Accent glow for selected ring */}
        <filter id="glow-accent" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feFlood floodColor="#F5A35C" floodOpacity="0.7" result="color" />
          <feComposite in="color" in2="blur" operator="in" result="shadow" />
          <feMerge><feMergeNode in="shadow" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      <AnimatePresence>
        {markers.map(({ id, x, y, quake }) => {
          const color    = getMagnitudeColor(quake.magnitude)
          const r        = getMagnitudeRadius(quake.magnitude)
          const isSelected = id === selectedId
          const filterId = quake.magnitude >= 6 ? 'glow-red' : quake.magnitude >= 4 ? 'glow-amber' : 'glow-green'

          return (
            <motion.g
              key={id}
              style={{ pointerEvents: 'all', cursor: 'pointer' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              onClick={() => onSelect(quake)}
              aria-label={`Earthquake M${quake.magnitude.toFixed(1)} at ${quake.place}`}
            >
              <g transform={`translate(${x},${y})`}>
                {/* Selection outer ring — accent-colored with glow */}
                {isSelected && (
                  <motion.circle
                    cx={0} cy={0} r={r + 6}
                    fill="none"
                    stroke="#F5A35C"
                    strokeWidth={1.5}
                    filter="url(#glow-accent)"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 0.85, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 280, damping: 22 }}
                    style={{ transformOrigin: '0 0' }}
                  />
                )}

                {/* Main dot */}
                <motion.circle
                  cx={0} cy={0} r={r}
                  fill={color}
                  filter={`url(#${filterId})`}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: isSelected ? 1.35 : 1, opacity: isSelected ? 1 : 0.90 }}
                  transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 24 }}
                  whileHover={{ scale: isSelected ? 1.4 : 1.3, opacity: 1 }}
                  style={{ transformOrigin: '0 0' }}
                />

                {/* Invisible larger hit target for easier clicking */}
                <circle cx={0} cy={0} r={Math.max(r + 8, 14)} fill="transparent" />
              </g>
            </motion.g>
          )
        })}
      </AnimatePresence>
    </svg>
  )
}
