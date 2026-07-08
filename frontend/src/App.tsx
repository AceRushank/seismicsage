import { useRef, useState, useCallback, useEffect } from 'react'
import { motion } from 'framer-motion'
import type * as d3 from 'd3'

import { EarthGlobe, type EarthGlobeHandle } from './components/Globe/EarthGlobe'
import { QuakeMarkers } from './components/Globe/QuakeMarkers'
import { TopBar } from './components/TopBar'
import { FilterPills } from './components/FilterPills'
import { QuakeList } from './components/QuakeList'
import { StatsRow } from './components/StatsRow'
import { AnalysisPanel } from './components/AnalysisPanel'
import { Legend } from './components/Legend'

import { useEarthquakes } from './hooks/useEarthquakes'
import { useAnalysis } from './hooks/useAnalysis'

import type { Earthquake, FilterState, FeedId } from './lib/types'
import type { GeoRotation } from './components/Globe/globeProjection'

// ─── Feed selector ─────────────────────────────────────────────────────────────

function feedFromFilter(filter: FilterState): FeedId {
  // 24h filter → more-active daily feed; 7-day → significant_week
  return filter.time === 'day' ? '4.5_day' : 'significant_week'
}

function applyMagnitudeFilter(quakes: Earthquake[], filter: FilterState): Earthquake[] {
  switch (filter.magnitude) {
    case 'm6plus': return quakes.filter((q) => q.magnitude >= 6)
    case 'm4plus': return quakes.filter((q) => q.magnitude >= 4)
    default:       return quakes
  }
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  // ── Reduced-motion preference ────────────────────────────────────────────
  const [reducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  // ── Globe shared state (refs — never cause re-renders) ──────────────────
  const globeRef = useRef<EarthGlobeHandle>(null)
  const rotationRef = useRef<GeoRotation>([0, -25, 0])
  const projectionRef = useRef<d3.GeoProjection | null>(null)

  // Called every animation frame by EarthGlobe — updates refs, not state
  const handleRotationChange = useCallback((r: GeoRotation) => {
    rotationRef.current = r
    if (globeRef.current) {
      projectionRef.current = globeRef.current.getProjection()
    }
  }, [])

  // ── Filter / feed state ──────────────────────────────────────────────────
  const [filter, setFilter] = useState<FilterState>({ magnitude: 'all', time: 'week' })
  const feed = feedFromFilter(filter)

  // ── Data ─────────────────────────────────────────────────────────────────
  const { earthquakes: allQuakes, stats, loading, stale } = useEarthquakes(feed)
  const filteredQuakes = applyMagnitudeFilter(allQuakes, filter)

  // ── Selection state ───────────────────────────────────────────────────────
  const [selectedQuake, setSelectedQuake] = useState<Earthquake | null>(null)
  const { analysis, loading: analysisLoading, error: analysisError, fetchAnalysis, clearAnalysis } =
    useAnalysis()

  const handleSelectQuake = useCallback(
    (quake: Earthquake) => {
      if (selectedQuake?.id === quake.id) {
        // Deselect: close drawer
        setSelectedQuake(null)
        clearAnalysis()
        return
      }
      setSelectedQuake(quake)
      fetchAnalysis(quake.id, feed)
    },
    [selectedQuake, clearAnalysis, fetchAnalysis, feed],
  )

  const handleClose = useCallback(() => {
    setSelectedQuake(null)
    clearAnalysis()
  }, [clearAnalysis])

  // Clear selection when the feed changes (quake IDs are feed-specific)
  useEffect(() => {
    setSelectedQuake(null)
    clearAnalysis()
  }, [feed, clearAnalysis])

  return (
    <div className="app-shell">

      {/* ── Globe layer: full-bleed canvas background ── */}
      <motion.div
        className="globe-layer"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
      >
        <EarthGlobe
          ref={globeRef}
          onRotationChange={handleRotationChange}
          reducedMotion={reducedMotion}
        />

        {/* SVG marker overlay — absolutely positioned over the canvas */}
        <QuakeMarkers
          earthquakes={filteredQuakes}
          rotationRef={rotationRef}
          projectionRef={projectionRef}
          selectedId={selectedQuake?.id ?? null}
          onSelect={handleSelectQuake}
          reducedMotion={reducedMotion}
        />
      </motion.div>

      {/* ── zone-top: TopBar (left-aligned) + FilterPills (right-aligned) ── */}
      {/*    Both share left:24px / right:24px → guaranteed vertical alignment */}
      <div className="zone-top">
        <TopBar
          eventCount={filteredQuakes.length}
          stale={stale}
          stats={stats}
        />
        <FilterPills filter={filter} onChange={setFilter} />
      </div>

      {/* ── zone-left: QuakeList ── */}
      {/*    left:24px matches zone-top's left:24px exactly */}
      <div className="zone-left">
        <QuakeList
          earthquakes={filteredQuakes}
          selectedId={selectedQuake?.id ?? null}
          loading={loading}
          onSelect={handleSelectQuake}
        />
      </div>

      {/* ── zone-right: Legend ── */}
      {/*    right:24px matches zone-top's right:24px exactly */}
      <div className="zone-right">
        <Legend />
      </div>

      {/* ── zone-bottom: StatsRow + AnalysisPanel as one stacked group ── */}
      {/*    12px gap between them; pointer-events:none on container (set in CSS) */}
      {/*    so the invisible flex wrapper doesn't block globe drag in centre-bottom */}
      <div className="zone-bottom">
        {/* AnalysisPanel renders above StatsRow (flex-direction: column means */}
        {/* first child is at bottom, last is at top — so panel goes first) */}
        <AnalysisPanel
          selectedQuake={selectedQuake}
          analysis={analysis}
          loading={analysisLoading}
          error={analysisError}
          onClose={handleClose}
        />
        <StatsRow stats={stats} />
      </div>

    </div>
  )
}
