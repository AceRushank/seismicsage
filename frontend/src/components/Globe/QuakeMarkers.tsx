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
  if (mag >= 6) return 7   // 14px diameter
  if (mag >= 4) return 5   // 10px diameter
  return 3.5               // 7px diameter
}

function isRecentQuake(timeStr: string): boolean {
  return Date.now() - new Date(timeStr).getTime() < 6 * 60 * 60 * 1000
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface MarkerData {
  id: string
  x: number
  y: number
  quake: Earthquake
  isRecent: boolean
}

interface QuakeMarkersProps {
  earthquakes: Earthquake[]
  /** Ref to the shared GeoRotation — written by EarthGlobe, read here */
  rotationRef: React.RefObject<GeoRotation>
  /** Ref to the shared projection — written by EarthGlobe, read here */
  projectionRef: React.RefObject<d3.GeoProjection | null>
  selectedId: string | null
  onSelect: (quake: Earthquake) => void
  reducedMotion: boolean
}

// ─── Component ───────────────────────────────────────────────────────────────

export function QuakeMarkers({
  earthquakes,
  rotationRef,
  projectionRef,
  selectedId,
  onSelect,
  reducedMotion,
}: QuakeMarkersProps) {
  const [markers, setMarkers] = useState<MarkerData[]>([])
  const rafRef = useRef<number | null>(null)
  const lastUpdateRef = useRef(0)

  // Re-project markers at ~30fps (throttled RAF).
  // Position update is completely decoupled from Framer Motion animations.
  const update = useCallback((timestamp: number) => {
    // Throttle to 30fps to avoid excessive React state updates
    if (timestamp - lastUpdateRef.current >= 33) {
      lastUpdateRef.current = timestamp
      const rotation = rotationRef.current
      const projection = projectionRef.current
      if (rotation && projection) {
        const newMarkers: MarkerData[] = []
        for (const quake of earthquakes) {
          if (!isVisible(quake.longitude, quake.latitude, rotation)) continue
          const pt = projection([quake.longitude, quake.latitude])
          if (!pt) continue
          newMarkers.push({
            id: quake.id,
            x: pt[0],
            y: pt[1],
            quake,
            isRecent: isRecentQuake(quake.time),
          })
        }
        setMarkers(newMarkers)
      }
    }
    rafRef.current = requestAnimationFrame(update)
  }, [earthquakes, rotationRef, projectionRef])

  useEffect(() => {
    rafRef.current = requestAnimationFrame(update)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [update])

  return (
    <svg
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        // CRITICAL: pointerEvents none on SVG but 'all' on marker groups
        // overflow: visible ensures ripples aren't clipped at SVG boundary
        pointerEvents: 'none',
        overflow: 'visible',
        // z-index must be above the canvas (z:0) — inline SVG inherits stacking
        zIndex: 10,
      }}
      aria-label="Earthquake markers on globe"
    >
      {/* SVG defs: per-color drop-shadow filters for glow effect */}
      <defs>
        <filter id="glow-red" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feFlood floodColor="#c0392b" floodOpacity="0.5" result="color" />
          <feComposite in="color" in2="blur" operator="in" result="shadow" />
          <feMerge>
            <feMergeNode in="shadow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="glow-amber" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feFlood floodColor="#ef9f27" floodOpacity="0.45" result="color" />
          <feComposite in="color" in2="blur" operator="in" result="shadow" />
          <feMerge>
            <feMergeNode in="shadow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="glow-green" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feFlood floodColor="#639922" floodOpacity="0.4" result="color" />
          <feComposite in="color" in2="blur" operator="in" result="shadow" />
          <feMerge>
            <feMergeNode in="shadow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <AnimatePresence>
        {markers.map(({ id, x, y, quake, isRecent }) => {
          const color = getMagnitudeColor(quake.magnitude)
          const r = getMagnitudeRadius(quake.magnitude)
          const isSelected = id === selectedId
          const filterId =
            quake.magnitude >= 6
              ? 'glow-red'
              : quake.magnitude >= 4
              ? 'glow-amber'
              : 'glow-green'

          return (
            <motion.g
              key={id}
              style={{ pointerEvents: 'all', cursor: 'pointer' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => onSelect(quake)}
              aria-label={`Earthquake M${quake.magnitude} at ${quake.place}`}
            >
              {/* Translate wrapper — updated imperatively-ish via state */}
              <g transform={`translate(${x}, ${y})`}>
                {/* Animated ripple ring for recent quakes
                    FIX: use explicit x/y on the circle (not just r) so the
                    transform origin is correct. Use CSS animation as a fallback
                    in case Framer Motion layoutId conflicts suppress it. */}
                {isRecent && !reducedMotion && (
                  <>
                    {/* Outer ripple — starts at 1× and expands to 3.5× */}
                    <motion.circle
                      cx={0}
                      cy={0}
                      r={r}
                      fill="none"
                      stroke={color}
                      strokeWidth={1.5}
                      style={{ transformOrigin: '0 0' }}
                      initial={{ scale: 1, opacity: 0.7 }}
                      animate={{ scale: 3.5, opacity: 0 }}
                      transition={{
                        duration: 2.2,
                        repeat: Infinity,
                        ease: 'easeOut',
                        delay: (quake.significance % 7) * 0.25,
                      }}
                    />
                    {/* Inner ripple — offset phase so there are two visible rings */}
                    <motion.circle
                      cx={0}
                      cy={0}
                      r={r}
                      fill="none"
                      stroke={color}
                      strokeWidth={1}
                      style={{ transformOrigin: '0 0' }}
                      initial={{ scale: 1, opacity: 0.5 }}
                      animate={{ scale: 2.2, opacity: 0 }}
                      transition={{
                        duration: 2.2,
                        repeat: Infinity,
                        ease: 'easeOut',
                        delay: ((quake.significance % 7) * 0.25) + 0.6,
                      }}
                    />
                  </>
                )}

                {/* Selection outer ring */}
                {isSelected && (
                  <motion.circle
                    cx={0}
                    cy={0}
                    r={r + 5}
                    fill="none"
                    stroke={color}
                    strokeWidth={1.5}
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 0.6, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  />
                )}

                {/* Main dot — with SVG drop-shadow glow */}
                <motion.circle
                  cx={0}
                  cy={0}
                  r={r}
                  fill={color}
                  filter={`url(#${filterId})`}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{
                    scale: isSelected ? 1.35 : 1,
                    opacity: isSelected ? 1 : 0.88,
                  }}
                  transition={{ type: 'spring', stiffness: 300, damping: 22 }}
                  whileHover={{ scale: isSelected ? 1.4 : 1.25, opacity: 1 }}
                  style={{ transformOrigin: '0 0' }}
                />
              </g>
            </motion.g>
          )
        })}
      </AnimatePresence>
    </svg>
  )
}
