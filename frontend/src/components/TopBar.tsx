import { motion } from 'framer-motion'
import { GlassPanel } from './GlassPanel/GlassPanel'
import type { StatsResponse } from '../lib/types'

interface TopBarProps {
  eventCount: number
  stale:      boolean
  stats:      StatsResponse | null
}

export function TopBar({ eventCount, stale }: TopBarProps) {
  const dotColor = stale ? '#ef9f27' : '#639922'

  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
      style={{ flexShrink: 0 }}
    >
      <GlassPanel
        intensity="strong"
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 20px', borderRadius: 40 }}
      >
        {/* Logo */}
        <img src="/logo.svg" alt="SeismicSage" width={26} height={26} />

        {/* Wordmark */}
        <span
          style={{
            fontFamily:    "'Inter', sans-serif",
            fontWeight:    700,
            fontSize:      16,
            letterSpacing: '-0.025em',
            color:         'var(--text-primary)',
          }}
        >
          SeismicSage
        </span>

        {/* Divider */}
        <span style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.10)', margin: '0 2px' }} />

        {/* Live status — glow-expand pulse (sonar-ping style) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ position: 'relative', width: 8, height: 8, flexShrink: 0 }}>
            {/* Expanding glow ring */}
            <motion.span
              animate={{
                scale:   [1, 2.5],
                opacity: [0.7, 0],
              }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeOut', repeatDelay: 0.4 }}
              style={{
                position:    'absolute',
                inset:       0,
                borderRadius:'50%',
                background:  dotColor,
              }}
            />
            {/* Solid core dot */}
            <span
              style={{
                position:    'absolute',
                inset:       0,
                borderRadius:'50%',
                background:  dotColor,
              }}
            />
          </span>

          {/* Event count — monospace */}
          <span
            style={{
              fontSize:   13,
              fontFamily: 'var(--font-mono)',
              fontWeight: 400,
              color:      'var(--text-secondary)',
              letterSpacing: '-0.02em',
            }}
          >
            {eventCount.toLocaleString()} events
            {stale && (
              <span style={{ fontSize: 10, marginLeft: 6, color: 'var(--quake-amber)', letterSpacing: 0 }}>
                stale
              </span>
            )}
          </span>
        </div>
      </GlassPanel>
    </motion.div>
  )
}
