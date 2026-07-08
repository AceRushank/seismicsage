import { motion, AnimatePresence } from 'framer-motion'
import { GlassPanel } from './GlassPanel/GlassPanel'
import type { AnalysisResponse, Earthquake } from '../lib/types'
import { getMagnitudeColor, formatMagnitude } from '../lib/quakeUtils'

// ─── Constants ─────────────────────────────────────────────────────────────────
export const ANALYSIS_PANEL_HEIGHT = 280  // px — used by StatsRow to clear the panel

// ─── Props ────────────────────────────────────────────────────────────────────

interface AnalysisPanelProps {
  selectedQuake: Earthquake | null
  analysis: AnalysisResponse | null
  loading: boolean
  error: string | null
  onClose: () => void
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AnalysisPanel({
  selectedQuake,
  analysis,
  loading,
  error,
  onClose,
}: AnalysisPanelProps) {
  return (
    <AnimatePresence>
      {selectedQuake && (
        <motion.div
          key="analysis-drawer"
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
            {/* ─ Header ─ */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                {/* Magnitude badge */}
                <MagnitudeBadge magnitude={selectedQuake.magnitude} />
                {/* Place */}
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

              {/* Close button */}
              <button
                id="close-analysis-panel"
                onClick={onClose}
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
            </div>

            {/* ─ Content ─ */}
            {loading && <SkeletonBody />}
            {error && !loading && <ErrorState error={error} />}
            {analysis && !loading && <AnalysisBody analysis={analysis} quake={selectedQuake} />}
          </GlassPanel>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

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
      {/* Summary */}
      <p
        style={{
          fontSize: 13.5,
          lineHeight: 1.6,
          color: 'var(--text-primary)',
        }}
      >
        {analysis.summary}
      </p>

      {/* Geological context grid */}
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

      {/* Historical context */}
      <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
        {ctx.historical_context}
      </p>

      {/* Risk assessment */}
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

      {/* Footer: tags + confidence + cached */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {/* Confidence badge */}
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

        {/* Tags */}
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

        {/* Cached indicator */}
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
