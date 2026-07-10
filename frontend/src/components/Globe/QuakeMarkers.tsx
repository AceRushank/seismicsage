/**
 * QuakeMarkers — zero-lag SVG quake dot overlay.
 *
 * Root cause of old lag: React useState for marker positions causes async
 * batched re-renders that are 1-2 frames behind the canvas rotation.
 *
 * Fix: ALL position updates go through direct DOM writes
 * (el.setAttribute('transform', 'translate(x,y)')) inside the RAF loop.
 * React state is NOT used for position — only for identity (which quakes
 * currently have mounted SVG elements), and even that is driven by the
 * earthquakes prop, not the RAF loop.
 *
 * Layering:
 *   - Outer <g ref>   : position, written imperatively every frame, no React
 *   - Inner <motion.g>: scale/opacity spring, never touches position coords
 */

import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
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

// ─── Props ────────────────────────────────────────────────────────────────────

interface QuakeMarkersProps {
  earthquakes:   Earthquake[]
  rotationRef:   React.RefObject<GeoRotation>
  projectionRef: React.RefObject<d3.GeoProjection | null>
  selectedId:    string | null
  onSelect:      (quake: Earthquake) => void
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
  // Map from quake id → the outer <g> element that we write transform to
  const posRefs = useRef(new Map<string, SVGGElement>())

  // Imperative position loop — runs every RAF frame, zero React involvement
  const earthquakesRef = useRef(earthquakes)
  useEffect(() => { earthquakesRef.current = earthquakes }, [earthquakes])

  useEffect(() => {
    let raf: number

    const update = () => {
      const rot  = rotationRef.current
      const proj = projectionRef.current

      if (rot && proj) {
        for (const q of earthquakesRef.current) {
          const el = posRefs.current.get(q.id)
          if (!el) continue

          if (!isVisible(q.longitude, q.latitude, rot)) {
            // Hide: direct style write, no transition
            if (el.style.visibility !== 'hidden') {
              el.style.visibility = 'hidden'
            }
            continue
          }

          const pt = proj([q.longitude, q.latitude])
          if (!pt) {
            if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden'
            continue
          }

          // Direct SVG attribute write — same frame as canvas rotation
          el.setAttribute('transform', `translate(${pt[0]},${pt[1]})`)
          if (el.style.visibility !== 'visible') {
            el.style.visibility = 'visible'
          }
        }
      }

      raf = requestAnimationFrame(update)
    }

    raf = requestAnimationFrame(update)
    return () => cancelAnimationFrame(raf)
  }, [rotationRef, projectionRef])   // only changes if refs change (never in practice)

  return (
    <svg
      style={{
        position: 'absolute', inset: 0,
        width: '100%', height: '100%',
        // No pointer-events on the SVG itself — only on <g> children
        pointerEvents: 'none',
        overflow: 'visible',
        zIndex: 10,
      }}
      aria-label="Earthquake markers"
    >
      <defs>
        {/* Per-magnitude drop-shadow glow filters */}
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
        {/* Blue accent glow for selection ring */}
        <filter id="glow-sel" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feFlood floodColor="#4EA1F7" floodOpacity="0.7" result="color" />
          <feComposite in="color" in2="blur" operator="in" result="shadow" />
          <feMerge><feMergeNode in="shadow" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/*
        Render ALL earthquakes as SVG elements upfront (not just visible ones).
        Visibility is toggled imperatively in the RAF loop above.
        Starting visibility:hidden prevents flash-at-origin on first frame.
      */}
      {earthquakes.map((quake) => {
        const color    = getMagnitudeColor(quake.magnitude)
        const r        = getMagnitudeRadius(quake.magnitude)
        const isSelected = quake.id === selectedId
        const filterId = quake.magnitude >= 6 ? 'glow-red' : quake.magnitude >= 4 ? 'glow-amber' : 'glow-green'

        return (
          /*
            OUTER <g>: position layer — written by RAF imperatively.
            No Framer Motion here. No CSS transition on transform.
            Starts at translate(0,0) visibility:hidden — RAF overwrites before paint.
          */
          <g
            key={quake.id}
            ref={(el) => {
              if (el) posRefs.current.set(quake.id, el)
              else    posRefs.current.delete(quake.id)
            }}
            style={{
              visibility: 'hidden',  // hidden until RAF positions it
              pointerEvents: 'all',
              cursor: 'pointer',
            }}
            onClick={() => onSelect(quake)}
            aria-label={`Earthquake M${quake.magnitude.toFixed(1)} at ${quake.place}`}
          >
            {/*
              INNER <motion.g>: animation layer — handles scale/opacity/spring.
              transformOrigin: '0 0' so scale origin is the quake's projected point.
              Never touches x/y position — that's the outer <g>'s job.
            */}
            <motion.g
              style={{ transformOrigin: '0 0' }}
              initial={reducedMotion ? false : { scale: 0, opacity: 0 }}
              animate={{
                scale:   isSelected ? 1.35 : 1,
                opacity: isSelected ? 1    : 0.92,
              }}
              transition={reducedMotion
                ? { duration: 0 }
                : { type: 'spring', stiffness: 320, damping: 26 }
              }
              whileHover={{ scale: isSelected ? 1.45 : 1.3, opacity: 1 }}
            >
              {/* Selection ring — blue accent */}
              {isSelected && (
                <motion.circle
                  cx={0} cy={0} r={r + 6}
                  fill="none"
                  stroke="#4EA1F7"
                  strokeWidth={1.5}
                  filter="url(#glow-sel)"
                  style={{ transformOrigin: '0 0' }}
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 0.9,  scale: 1 }}
                  transition={{ type: 'spring', stiffness: 280, damping: 22 }}
                />
              )}

              {/* Main dot */}
              <circle
                cx={0} cy={0}
                r={r}
                fill={color}
                filter={`url(#${filterId})`}
              />

              {/* Larger invisible hit target — easier to click small dots */}
              <circle cx={0} cy={0} r={Math.max(r + 8, 14)} fill="transparent" />
            </motion.g>
          </g>
        )
      })}
    </svg>
  )
}
