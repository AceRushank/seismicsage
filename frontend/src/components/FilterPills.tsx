import { useId } from 'react'
import { motion } from 'framer-motion'
import { GlassPanel } from './GlassPanel/GlassPanel'
import type { FilterState } from '../lib/types'

// ─── Pill definitions ─────────────────────────────────────────────────────────

type PillKey = 'all' | 'm4plus' | 'm6plus' | 'day' | 'week'

interface PillDef {
  key:   PillKey
  label: string
  group: 'magnitude' | 'time'
}

const PILLS: PillDef[] = [
  { key: 'all',    label: 'All',    group: 'magnitude' },
  { key: 'm4plus', label: 'M4+',    group: 'magnitude' },
  { key: 'm6plus', label: 'M6+',    group: 'magnitude' },
  { key: 'day',    label: '24h',    group: 'time' },
  { key: 'week',   label: '7 days', group: 'time' },
]

// ─── Shared pill group styles ─────────────────────────────────────────────────

const GROUP_STYLE: React.CSSProperties = {
  display:       'flex',
  flexDirection: 'column',
  gap:            3,
  padding:       '6px',
  borderRadius:  16,
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface FilterPillsProps {
  filter:   FilterState
  onChange: (next: FilterState) => void
}

// ─── Component ───────────────────────────────────────────────────────────────

export function FilterPills({ filter, onChange }: FilterPillsProps) {
  const layoutId = useId()

  const isActive = (pill: PillDef) =>
    pill.group === 'magnitude' ? filter.magnitude === pill.key : filter.time === pill.key

  const handleClick = (pill: PillDef) => {
    if (pill.group === 'magnitude') onChange({ ...filter, magnitude: pill.key as FilterState['magnitude'] })
    else                            onChange({ ...filter, time: pill.key as FilterState['time'] })
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}
      style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      {/* Magnitude group */}
      <GlassPanel intensity="light" style={GROUP_STYLE}>
        {PILLS.filter(p => p.group === 'magnitude').map(pill => (
          <Pill
            key={pill.key}
            pill={pill}
            active={isActive(pill)}
            layoutId={`${layoutId}-mag`}
            onClick={() => handleClick(pill)}
          />
        ))}
      </GlassPanel>

      {/* Time group */}
      <GlassPanel intensity="light" style={GROUP_STYLE}>
        {PILLS.filter(p => p.group === 'time').map(pill => (
          <Pill
            key={pill.key}
            pill={pill}
            active={isActive(pill)}
            layoutId={`${layoutId}-time`}
            onClick={() => handleClick(pill)}
          />
        ))}
      </GlassPanel>

      {/* Fault lines toggle */}
      <GlassPanel intensity="light" style={GROUP_STYLE}>
        <button
          id="fault-lines-toggle"
          onClick={() => onChange({ ...filter, showFaultLines: !filter.showFaultLines })}
          title={filter.showFaultLines ? 'Hide fault lines' : 'Show fault lines'}
          style={{
            position:     'relative',
            display:      'block',
            padding:      '7px 14px',
            border:       'none',
            borderRadius: 10,
            cursor:       'pointer',
            background:   'transparent',
            fontSize:     11,
            fontWeight:   700,
            fontFamily:   'inherit',
            letterSpacing:'0.08em',
            textTransform:'uppercase',
            color: filter.showFaultLines ? 'var(--accent)' : 'var(--text-tertiary)',
            transition:   'color 150ms ease',
            textAlign:    'center',
            minWidth:     68,
            outline:      'none',
            zIndex:        1,
            whiteSpace:   'nowrap',
          }}
        >
          {filter.showFaultLines && (
            <motion.span
              layoutId={`${layoutId}-fault`}
              style={{
                position:   'absolute',
                inset:      0,
                borderRadius: 10,
                background: 'rgba(78,161,247,0.12)',
                boxShadow:  '0 0 20px -4px var(--accent)',
                zIndex:     -1,
              }}
              transition={{ type: 'spring', stiffness: 420, damping: 38 }}
            />
          )}
          ╌ Faults
        </button>
      </GlassPanel>
    </motion.div>
  )
}

// ─── Pill sub-component ───────────────────────────────────────────────────────

interface PillProps {
  pill:     PillDef
  active:   boolean
  layoutId: string
  onClick:  () => void
}

function Pill({ pill, active, layoutId, onClick }: PillProps) {
  return (
    <button
      onClick={onClick}
      style={{
        position:     'relative',
        display:      'block',
        padding:      '7px 14px',
        border:       'none',
        borderRadius: 10,
        cursor:       'pointer',
        background:   'transparent',
        fontSize:     11,
        fontWeight:   700,
        fontFamily:   'inherit',
        letterSpacing:'0.08em',
        textTransform:'uppercase',
        color: active ? 'var(--accent)' : 'var(--text-tertiary)',
        transition:   'color 150ms ease',
        textAlign:    'center',
        minWidth:     68,
        outline:      'none',
        zIndex:        1,
      }}
    >
      {/* Sliding amber active indicator — shared-element between pills in group */}
      {active && (
        <motion.span
          layoutId={layoutId}
          style={{
            position:   'absolute',
            inset:      0,
            borderRadius: 10,
            background: 'rgba(78,161,247,0.12)',
            boxShadow:  '0 0 20px -4px var(--accent)',
            zIndex:     -1,
          }}
          transition={{ type: 'spring', stiffness: 420, damping: 38 }}
        />
      )}
      {pill.label}
    </button>
  )
}
