import { useEffect } from 'react'
import { motion, useSpring, useTransform } from 'framer-motion'
import { GlassPanel } from './GlassPanel/GlassPanel'
import type { StatsResponse } from '../lib/types'

// ─── Animated monospace counter ───────────────────────────────────────────────

function AnimatedNumber({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const spring  = useSpring(0, { stiffness: 90, damping: 28 })
  const display = useTransform(spring, (v) =>
    decimals > 0 ? v.toFixed(decimals) : Math.round(v).toString()
  )
  useEffect(() => { spring.set(value) }, [value, spring])
  return <motion.span style={{ fontFamily: 'var(--font-mono)' }}>{display}</motion.span>
}

// ─── Stat pill ────────────────────────────────────────────────────────────────

interface StatPillProps {
  label:    string
  value:    number | null
  decimals?: number
  accent?:  string
}

function StatPill({ label, value, decimals = 0, accent }: StatPillProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 20px', gap: 2 }}>
      <span
        style={{
          fontSize:      26,
          fontFamily:    'var(--font-mono)',
          fontWeight:    700,
          letterSpacing: '-0.04em',
          color:          accent ?? 'var(--text-primary)',
          lineHeight:    1,
        }}
      >
        {value == null ? '—' : <AnimatedNumber value={value} decimals={decimals} />}
      </span>
      <span
        style={{
          fontSize:      10,
          fontWeight:    500,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color:         'var(--text-tertiary)',
        }}
      >
        {label}
      </span>
    </div>
  )
}

// Dark glass divider
const DIVIDER = (
  <span
    style={{
      width:      1,
      alignSelf:  'stretch',
      background: 'rgba(255,255,255,0.07)',
      margin:     '6px 0',
    }}
  />
)

// ─── Component ───────────────────────────────────────────────────────────────

interface StatsRowProps { stats: StatsResponse | null }

export function StatsRow({ stats }: StatsRowProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.20, ease: [0.22, 1, 0.36, 1] }}
    >
      <GlassPanel intensity="medium" style={{ display: 'flex', alignItems: 'stretch', borderRadius: 20, overflow: 'hidden' }}>
        <StatPill label="Total"     value={stats?.total_count      ?? null} />
        {DIVIDER}
        <StatPill label="Largest"   value={stats?.largest_magnitude ?? null} decimals={1} accent="#c0392b" />
        {DIVIDER}
        <StatPill label="Above M4"  value={stats?.count_above_m4   ?? null} accent="#ef9f27" />
        {DIVIDER}
        <StatPill label="Above M6"  value={stats?.count_above_m6   ?? null} accent="#c0392b" />
      </GlassPanel>
    </motion.div>
  )
}
