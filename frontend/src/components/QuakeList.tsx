import { useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { GlassPanel } from './GlassPanel/GlassPanel'
import type { Earthquake } from '../lib/types'
import { formatRelativeTime, getMagnitudeColor, getMagnitudeTier } from '../lib/quakeUtils'

interface QuakeListProps {
  earthquakes: Earthquake[]
  selectedId:  string | null
  loading:     boolean
  onSelect:    (quake: Earthquake) => void
}

export function QuakeList({ earthquakes, selectedId, loading, onSelect }: QuakeListProps) {
  const listRef = useRef<HTMLDivElement>(null)

  return (
    <motion.div
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.55, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
      style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
    >
      <GlassPanel
        intensity="light"
        style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', maxHeight: '100%' }}
      >
        {/* Header */}
        <div
          style={{
            padding:      '12px 16px 8px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            flexShrink:    0,
          }}
        >
          <h2
            style={{
              fontSize:      10,
              fontWeight:    700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color:         'var(--text-tertiary)',
            }}
          >
            Recent Events
          </h2>
        </div>

        {/* Scrollable list */}
        <div ref={listRef} style={{ overflowY: 'auto', flex: 1 }}>
          {loading && earthquakes.length === 0 ? (
            <SkeletonRows />
          ) : earthquakes.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12 }}
            >
              No events match the current filters
            </motion.div>
          ) : (
            <AnimatePresence initial={false}>
              {earthquakes.map((quake, idx) => (
                <QuakeRow
                  key={quake.id}
                  quake={quake}
                  isSelected={quake.id === selectedId}
                  index={idx}
                  onSelect={onSelect}
                />
              ))}
            </AnimatePresence>
          )}
        </div>
      </GlassPanel>
    </motion.div>
  )
}

// ─── Row ──────────────────────────────────────────────────────────────────────

interface QuakeRowProps {
  quake:      Earthquake
  isSelected: boolean
  index:      number
  onSelect:   (quake: Earthquake) => void
}

function QuakeRow({ quake, isSelected, index, onSelect }: QuakeRowProps) {
  const color = getMagnitudeColor(quake.magnitude)
  const tier  = getMagnitudeTier(quake.magnitude)

  return (
    <motion.button
      layout
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      transition={{ duration: 0.28, delay: index < 15 ? index * 0.04 : 0, ease: [0.22, 1, 0.36, 1] }}
      onClick={() => onSelect(quake)}
      style={{
        display:     'flex',
        alignItems:  'center',
        gap:          10,
        width:       '100%',
        padding:     '10px 14px',
        background:  isSelected ? 'rgba(78,161,247,0.08)' : 'transparent',
        border:      'none',
        borderBottom:'1px solid rgba(255,255,255,0.05)',
        // Left accent border — magnitude color, glows when selected
        borderLeft:  `2px solid ${color}`,
        boxShadow:   isSelected ? `-4px 0 14px -3px ${color}66` : 'none',
        cursor:      'pointer',
        textAlign:   'left',
        transition:  'background 150ms ease, box-shadow 150ms ease',
        fontFamily:  'inherit',
      }}
    >
      {/* Magnitude badge — monospace */}
      <span
        style={{
          minWidth:   38,
          padding:    '3px 0',
          borderRadius: 8,
          background: `${color}1a`,
          color,
          fontWeight:  700,
          fontSize:    13,
          fontFamily: 'var(--font-mono)',
          textAlign:  'center',
          flexShrink:  0,
          border:     `0.5px solid ${color}44`,
        }}
      >
        {quake.magnitude.toFixed(1)}
      </span>

      {/* Details */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize:     12.5,
            fontWeight:   isSelected ? 600 : 500,
            color:        'var(--text-primary)',
            overflow:     'hidden',
            textOverflow: 'ellipsis',
            whiteSpace:   'nowrap',
          }}
          title={quake.place}
        >
          {quake.place}
        </div>
        {/* Depth + time — monospace */}
        <div
          style={{
            fontSize:   10,
            fontFamily: 'var(--font-mono)',
            color:      'var(--text-tertiary)',
            marginTop:   2,
            display:    'flex',
            gap:         6,
          }}
        >
          <span>{quake.depth_km.toFixed(0)} km</span>
          <span>·</span>
          <span>{formatRelativeTime(quake.time)}</span>
        </div>
      </div>

      {/* Tsunami / tier badge */}
      {quake.tsunami_warning && (
        <span style={{ fontSize: 13, flexShrink: 0 }} title="Tsunami warning">🌊</span>
      )}
      {!quake.tsunami_warning && tier === 'major' && (
        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color, fontWeight: 700, flexShrink: 0 }}>M6+</span>
      )}
    </motion.button>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} style={{ padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'center', borderLeft: '2px solid rgba(255,255,255,0.06)' }}>
          <div className="skeleton" style={{ width: 38, height: 26, borderRadius: 8 }} />
          <div style={{ flex: 1 }}>
            <div className="skeleton" style={{ height: 11, width: '78%', marginBottom: 5 }} />
            <div className="skeleton" style={{ height: 9,  width: '46%' }} />
          </div>
        </div>
      ))}
    </>
  )
}
