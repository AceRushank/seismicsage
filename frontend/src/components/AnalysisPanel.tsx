import { motion, AnimatePresence } from 'framer-motion'
import { GlassPanel } from './GlassPanel/GlassPanel'
import type { AnalysisResponse, Earthquake, FaultAnalysisResponse } from '../lib/types'
import type { FaultFeature } from './Globe/EarthGlobe'
import { getMagnitudeColor, formatMagnitude } from '../lib/quakeUtils'

// ─── Constants ─────────────────────────────────────────────────────────────────
export const ANALYSIS_PANEL_HEIGHT = 280  // px

// ─── Fault boundary content ───────────────────────────────────────────────────

const BOUNDARY_COLORS: Record<string, string> = {
  subduction: '#dc3c28',
  transform:  '#dc8c1e',
  spreading:  '#3c8cc8',
  default:    '#966432',
}

const BOUNDARY_LABELS: Record<string, string> = {
  subduction: 'Subduction Boundary',
  transform:  'Transform Boundary',
  spreading:  'Spreading Boundary',
  default:    'Plate Boundary',
}

const BOUNDARY_DESCRIPTIONS: Record<string, string> = {
  subduction:
    'One plate dives beneath another. This produces the world\'s largest earthquakes and most destructive tsunamis — the 2011 Tōhoku and 2004 Indian Ocean events both occurred at subduction zones.',
  transform:
    'Two plates grind sideways past each other. Produces shallow, highly destructive earthquakes close to the surface — the 1906 San Francisco and 1999 İzmit earthquakes were transform events.',
  spreading:
    'Plates pull apart, creating new ocean floor. Generally lower seismic risk than convergent boundaries, but can produce significant earthquakes along fracture zones.',
  default:
    'A boundary between two tectonic plates. The nature of this boundary influences local seismic hazard and the character of earthquakes that occur in this region.',
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface AnalysisPanelProps {
  // Earthquake mode
  selectedQuake: Earthquake | null
  analysis: AnalysisResponse | null
  loading: boolean
  error: string | null
  onClose: () => void

  // Fault mode
  selectedFault?: FaultFeature | null
  nearbyQuakes?: Earthquake[]
  faultInsight?: FaultAnalysisResponse | null
  faultInsightLoading?: boolean
  onAskFaultAI?: () => void
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AnalysisPanel({
  selectedQuake,
  analysis,
  loading,
  error,
  onClose,
  selectedFault,
  nearbyQuakes = [],
  faultInsight,
  faultInsightLoading = false,
  onAskFaultAI,
}: AnalysisPanelProps) {
  const isOpen = !!(selectedQuake || selectedFault)

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key={selectedFault ? 'fault-drawer' : 'analysis-drawer'}
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          transition={{
            type: 'spring',
            stiffness: 280,
            damping: 32,
            opacity: { duration: 0.25, ease: 'easeOut' },
          }}
          style={{
            width: 'min(680px, calc(100vw - 48px))',
            maxHeight: ANALYSIS_PANEL_HEIGHT,
          }}
        >
          <GlassPanel
            intensity="strong"
            style={{
              padding: '16px 20px',
              maxHeight: ANALYSIS_PANEL_HEIGHT,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            {selectedFault ? (
              <FaultContent
                fault={selectedFault}
                nearbyQuakes={nearbyQuakes}
                insight={faultInsight}
                insightLoading={faultInsightLoading}
                onAskAI={onAskFaultAI}
                onClose={onClose}
              />
            ) : selectedQuake ? (
              <>
                {/* ─ Header ─ */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                    <MagnitudeBadge magnitude={selectedQuake.magnitude} />
                    <h2
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        letterSpacing: '-0.01em',
                      }}
                      title={selectedQuake.place}
                    >
                      {selectedQuake.place}
                    </h2>
                  </div>
                  <CloseButton onClick={onClose} />
                </div>

                {/* ─ Content ─ */}
                {loading && <SkeletonBody />}
                {error && !loading && <ErrorState error={error} />}
                {analysis && !loading && <AnalysisBody analysis={analysis} quake={selectedQuake} />}
              </>
            ) : null}
          </GlassPanel>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ─── Fault content view ───────────────────────────────────────────────────────

function FaultContent({
  fault,
  nearbyQuakes,
  insight,
  insightLoading,
  onAskAI,
  onClose,
}: {
  fault: FaultFeature
  nearbyQuakes: Earthquake[]
  insight: FaultAnalysisResponse | null | undefined
  insightLoading: boolean
  onAskAI?: () => void
  onClose: () => void
}) {
  const type = fault.boundaryType
  const color = BOUNDARY_COLORS[type] ?? BOUNDARY_COLORS.default
  const label = BOUNDARY_LABELS[type] ?? BOUNDARY_LABELS.default
  const description = BOUNDARY_DESCRIPTIONS[type] ?? BOUNDARY_DESCRIPTIONS.default

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Type badge */}
          <span
            style={{
              padding: '3px 10px',
              borderRadius: 10,
              background: `${color}1a`,
              color,
              fontWeight: 700,
              fontSize: 13,
              border: `0.5px solid ${color}44`,
              flexShrink: 0,
            }}
          >
            {label}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            {fault.clickLat.toFixed(1)}°, {fault.clickLng.toFixed(1)}°
          </span>
        </div>
        <CloseButton onClick={onClose} />
      </div>

      {/* Description */}
      <p style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-primary)' }}>
        {description}
      </p>

      {/* Nearby quakes */}
      {nearbyQuakes.length > 0 && (
        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--text-tertiary)',
              marginBottom: 6,
            }}
          >
            Nearby Recent Events
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {nearbyQuakes.slice(0, 3).map((q) => {
              const mc = getMagnitudeColor(q.magnitude)
              return (
                <span
                  key={q.id}
                  style={{
                    padding: '3px 10px',
                    borderRadius: 10,
                    fontSize: 11,
                    fontWeight: 500,
                    background: `${mc}14`,
                    color: mc,
                    border: `0.5px solid ${mc}44`,
                  }}
                >
                  {formatMagnitude(q.magnitude)} — {q.place.split(',')[0]}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* AI insight box */}
      {insight && !insightLoading && (
        <div
          style={{
            padding: '10px 12px',
            borderRadius: 12,
            background: 'rgba(26,24,20,0.04)',
            border: '0.5px solid rgba(26,24,20,0.08)',
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--text-tertiary)',
              marginBottom: 5,
            }}
          >
            AI Geological Insight
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text-primary)' }}>
            {insight.insight}
          </p>
        </div>
      )}

      {insightLoading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="skeleton" style={{ height: 13, width: '90%' }} />
          <div className="skeleton" style={{ height: 13, width: '70%' }} />
        </div>
      )}

      {/* Ask AI button */}
      {!insight && !insightLoading && onAskAI && (
        <button
          id="ask-fault-ai"
          onClick={onAskAI}
          style={{
            alignSelf: 'flex-start',
            padding: '7px 16px',
            borderRadius: 20,
            border: `1px solid ${color}44`,
            background: `${color}10`,
            color,
            fontSize: 12,
            fontWeight: 600,
            fontFamily: 'inherit',
            cursor: 'pointer',
            transition: 'background 150ms ease',
          }}
        >
          ✦ Ask AI about this fault
        </button>
      )}
    </div>
  )
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      id="close-analysis-panel"
      onClick={onClick}
      aria-label="Close analysis panel"
      style={{
        flexShrink: 0,
        marginLeft: 12,
        width: 24,
        height: 24,
        borderRadius: '50%',
        border: 'none',
        background: 'rgba(26,24,20,0.08)',
        color: 'var(--text-secondary)',
        cursor: 'pointer',
        fontSize: 16,
        lineHeight: '24px',
        textAlign: 'center',
        fontFamily: 'inherit',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      ×
    </button>
  )
}

function MagnitudeBadge({ magnitude }: { magnitude: number }) {
  const color = getMagnitudeColor(magnitude)
  return (
    <span
      style={{
        flexShrink: 0,
        padding: '3px 9px',
        borderRadius: 10,
        background: `${color}1a`,
        color,
        fontWeight: 700,
        fontSize: 14,
        border: `0.5px solid ${color}44`,
      }}
    >
      {formatMagnitude(magnitude)}
    </span>
  )
}

function AnalysisBody({ analysis, quake }: { analysis: AnalysisResponse; quake: Earthquake }) {
  const ctx = analysis.geological_context
  const isDataBacked = ctx.confidence === 'data-backed'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-primary)' }}>
        {analysis.summary}
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 8,
        }}
      >
        <ContextItem label="Tectonic Setting" value={ctx.tectonic_setting} />
        {ctx.fault_type && <ContextItem label="Fault Type" value={ctx.fault_type} />}
        {ctx.plate_boundary && (
          <ContextItem
            label="Plate Boundary"
            value={ctx.plate_boundary}
            sub={ctx.boundary_type ?? undefined}
          />
        )}
        {ctx.distance_to_boundary_km != null && (
          <ContextItem
            label="Distance to Boundary"
            value={`${Math.round(ctx.distance_to_boundary_km)} km`}
          />
        )}
        <ContextItem label="Depth" value={`${quake.depth_km.toFixed(0)} km`} />
      </div>

      <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
        {ctx.historical_context}
      </p>

      <div
        style={{
          padding: '10px 12px',
          borderRadius: 12,
          background: 'rgba(26,24,20,0.04)',
          border: '0.5px solid rgba(26,24,20,0.08)',
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--text-tertiary)',
            marginBottom: 5,
          }}
        >
          Risk Assessment
        </div>
        <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text-primary)' }}>
          {analysis.risk_assessment}
        </p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 20,
            fontSize: 11,
            fontWeight: 500,
            background: isDataBacked ? 'rgba(99,153,34,0.12)' : 'rgba(239,159,39,0.12)',
            color: isDataBacked ? '#639922' : '#ef9f27',
            border: `0.5px solid ${isDataBacked ? '#63992244' : '#ef9f2744'}`,
          }}
        >
          {isDataBacked ? '✓ PB2002 data-backed' : '~ AI-inferred context'}
        </span>

        {analysis.tags.map((tag) => (
          <span
            key={tag}
            style={{
              padding: '2px 8px',
              borderRadius: 20,
              fontSize: 11,
              background: 'rgba(26,24,20,0.06)',
              color: 'var(--text-secondary)',
              border: '0.5px solid rgba(26,24,20,0.1)',
            }}
          >
            {tag}
          </span>
        ))}

        {analysis.cached && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 10,
              color: 'var(--text-tertiary)',
              fontStyle: 'italic',
            }}
          >
            cached
          </span>
        )}
      </div>
    </div>
  )
}

function ContextItem({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--text-tertiary)',
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text-primary)' }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>{sub}</div>
      )}
    </div>
  )
}

function SkeletonBody() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="skeleton" style={{ height: 13, width: '90%' }} />
      <div className="skeleton" style={{ height: 13, width: '75%' }} />
      <div className="skeleton" style={{ height: 13, width: '60%' }} />
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        {[70, 90, 60].map((w, i) => (
          <div key={i} className="skeleton" style={{ height: 36, width: w, borderRadius: 8 }} />
        ))}
      </div>
      <div className="skeleton" style={{ height: 60, width: '100%', borderRadius: 12 }} />
    </div>
  )
}

function ErrorState({ error }: { error: string }) {
  return (
    <div
      style={{
        padding: '12px',
        borderRadius: 12,
        background: 'rgba(192,57,43,0.06)',
        border: '0.5px solid rgba(192,57,43,0.2)',
        color: '#c0392b',
        fontSize: 13,
      }}
    >
      <strong>Analysis failed:</strong> {error}
    </div>
  )
}
