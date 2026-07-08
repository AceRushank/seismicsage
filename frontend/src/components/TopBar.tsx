import { motion } from 'framer-motion'
import { GlassPanel } from './GlassPanel/GlassPanel'
import type { StatsResponse } from '../lib/types'

interface TopBarProps {
  eventCount: number
  stale: boolean
  stats: StatsResponse | null
}

export function TopBar({ eventCount, stale }: TopBarProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      style={{ flexShrink: 0 }}
    >
      {/* TopBar is the PRIMARY surface — intensity strong, slightly larger type */}
      <GlassPanel
        intensity="strong"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '11px 20px',
          borderRadius: 40, // pill shape
        }}
      >
        {/* Logo mark */}
        <img src="/logo.svg" alt="SeismicSage" width={26} height={26} />

        {/* Wordmark — primary surface gets larger weight */}
        <span
          style={{
            fontFamily: "'Inter', sans-serif",
            fontWeight: 700,
            fontSize: 16,
            letterSpacing: '-0.025em',
            color: 'var(--text-primary)',
          }}
        >
          SeismicSage
        </span>

        {/* Divider */}
        <span
          style={{
            width: 1,
            height: 16,
            background: 'rgba(26,24,20,0.15)',
            marginLeft: 2,
            marginRight: 2,
          }}
        />

        {/* Live event count with pulsing dot */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <motion.span
            animate={{ opacity: [1, 0.25, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: stale ? '#ef9f27' : '#639922',
              display: 'inline-block',
            }}
          />
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--text-secondary)',
            }}
          >
            {eventCount} events
            {stale && (
              <span style={{ fontSize: 11, marginLeft: 4, color: 'var(--quake-amber)' }}>
                stale
              </span>
            )}
          </span>
        </div>
      </GlassPanel>
    </motion.div>
  )
}
