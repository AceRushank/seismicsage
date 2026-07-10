import { useRef, useState, useCallback, useEffect } from 'react'
import { motion } from 'framer-motion'
import type * as d3 from 'd3'

import { EarthGlobe, type EarthGlobeHandle, type FaultFeature } from './components/Globe/EarthGlobe'
import { QuakeMarkers } from './components/Globe/QuakeMarkers'
import { TopBar } from './components/TopBar'
import { FilterPills } from './components/FilterPills'
import { QuakeList } from './components/QuakeList'
import { StatsRow } from './components/StatsRow'
import { AnalysisPanel } from './components/AnalysisPanel'
import { Legend } from './components/Legend'
import { FaultTooltip } from './components/FaultTooltip'

import { useEarthquakes } from './hooks/useEarthquakes'
import { useAnalysis } from './hooks/useAnalysis'
import { analyzeFault } from './lib/api'

import type { Earthquake, FilterState, FeedId, FaultAnalysisResponse } from './lib/types'
import type { GeoRotation } from './components/Globe/globeProjection'

// ─── Haversine distance (km) between two lat/lng points ──────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}

// ─── Feed selector ────────────────────────────────────────────────────────────

function feedFromFilter(filter: FilterState): FeedId {
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

  const handleRotationChange = useCallback((r: GeoRotation) => {
    rotationRef.current = r
    if (globeRef.current) {
      projectionRef.current = globeRef.current.getProjection()
    }
  }, [])

  // ── Filter / feed state ──────────────────────────────────────────────────
  const [filter, setFilter] = useState<FilterState>({
    magnitude: 'all',
    time: 'week',
    showFaultLines: true,
  })
  const feed = feedFromFilter(filter)

  // ── Data ─────────────────────────────────────────────────────────────────
  const { earthquakes: allQuakes, stats, loading, stale } = useEarthquakes(feed)
  const filteredQuakes = applyMagnitudeFilter(allQuakes, filter)

  // ── Earthquake selection ──────────────────────────────────────────────────
  const [selectedQuake, setSelectedQuake] = useState<Earthquake | null>(null)
  const { analysis, loading: analysisLoading, error: analysisError, fetchAnalysis, clearAnalysis } =
    useAnalysis()

  const handleSelectQuake = useCallback(
    (quake: Earthquake) => {
      // Selecting a quake clears fault selection
      setSelectedFault(null)
      setFaultInsight(null)
      if (selectedQuake?.id === quake.id) {
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
    setSelectedFault(null)
    setFaultInsight(null)
  }, [clearAnalysis])

  useEffect(() => {
    setSelectedQuake(null)
    clearAnalysis()
    setSelectedFault(null)
    setFaultInsight(null)
  }, [feed, clearAnalysis])

  // ── Fault selection ───────────────────────────────────────────────────────
  const [selectedFault, setSelectedFault] = useState<FaultFeature | null>(null)
  const [faultInsight, setFaultInsight] = useState<FaultAnalysisResponse | null>(null)
  const [faultInsightLoading, setFaultInsightLoading] = useState(false)

  const nearbyQuakes = selectedFault
    ? filteredQuakes.filter(
        (q) =>
          haversineKm(q.latitude, q.longitude, selectedFault.clickLat, selectedFault.clickLng) <= 300,
      )
    : []

  const handleFaultClick = useCallback((fault: FaultFeature) => {
    // Fault click clears quake selection
    setSelectedQuake(null)
    clearAnalysis()
    setFaultInsight(null)
    setSelectedFault(fault)
  }, [clearAnalysis])

  const handleAskFaultAI = useCallback(async () => {
    if (!selectedFault) return
    setFaultInsightLoading(true)
    try {
      const response = await analyzeFault({
        boundary_type: selectedFault.boundaryType,
        latitude: selectedFault.clickLat,
        longitude: selectedFault.clickLng,
        nearby_earthquake_ids: nearbyQuakes.slice(0, 5).map((q) => q.id),
      })
      setFaultInsight(response)
    } catch (err) {
      console.error('Fault AI error:', err)
    } finally {
      setFaultInsightLoading(false)
    }
  }, [selectedFault, nearbyQuakes])

  // ── Fault hover tooltip ───────────────────────────────────────────────────
  const [hoveredFault, setHoveredFault] = useState<FaultFeature | null>(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })

  const handleFaultHover = useCallback((fault: FaultFeature | null, x: number, y: number) => {
    setHoveredFault(fault)
    if (fault) setTooltipPos({ x, y })
  }, [])

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
          showFaultLines={filter.showFaultLines}
          earthquakes={filteredQuakes}
          onFaultHover={handleFaultHover}
          onFaultClick={handleFaultClick}
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
      <div className="zone-top">
        <TopBar
          eventCount={filteredQuakes.length}
          stale={stale}
          stats={stats}
        />
        <FilterPills filter={filter} onChange={setFilter} />
      </div>

      {/* ── zone-left: QuakeList ── */}
      <div className="zone-left">
        <QuakeList
          earthquakes={filteredQuakes}
          selectedId={selectedQuake?.id ?? null}
          loading={loading}
          onSelect={handleSelectQuake}
        />
      </div>

      {/* ── zone-right: Legend ── */}
      <div className="zone-right">
        <Legend />
      </div>

      {/* ── zone-bottom: StatsRow + AnalysisPanel as one stacked group ── */}
      <div className="zone-bottom">
        <AnalysisPanel
          selectedQuake={selectedQuake}
          analysis={analysis}
          loading={analysisLoading}
          error={analysisError}
          onClose={handleClose}
          selectedFault={selectedFault}
          nearbyQuakes={nearbyQuakes}
          faultInsight={faultInsight}
          faultInsightLoading={faultInsightLoading}
          onAskFaultAI={handleAskFaultAI}
        />
        <StatsRow stats={stats} />
      </div>

      {/* ── Fault hover tooltip — fixed, pointer-events:none ── */}
      <FaultTooltip fault={hoveredFault} x={tooltipPos.x} y={tooltipPos.y} />

    </div>
  )
}
