import { motion } from 'framer-motion'
import { GlassPanel } from './GlassPanel/GlassPanel'

interface LegendRowProps {
  color: string
  label: string
  size: number
}

function LegendRow({ color, label, size }: LegendRowProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <svg width={size * 2 + 4} height={size * 2 + 4} style={{ flexShrink: 0 }}>
        <circle
          cx={size + 2}
          cy={size + 2}
          r={size}
          fill={color}
          opacity={0.88}
        />
      </svg>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
        {label}
      </span>
    </div>
  )
}

export function Legend() {
  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      <GlassPanel
        intensity="light"
        style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--text-tertiary)',
            marginBottom: 2,
          }}
        >
          Magnitude
        </span>
        <LegendRow color="#c0392b" label="M6+ Major" size={7} />
        <LegendRow color="#ef9f27" label="M4–6 Moderate" size={5} />
        <LegendRow color="#639922" label="M&lt;4 Minor" size={3.5} />
        <span
          style={{
            fontSize: 10,
            color: 'var(--text-tertiary)',
            marginTop: 2,
            fontStyle: 'italic',
          }}
        >
          Size ∝ magnitude
        </span>
      </GlassPanel>
    </motion.div>
  )
}
