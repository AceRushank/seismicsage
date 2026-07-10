import { motion } from 'framer-motion'
import { GlassPanel } from './GlassPanel/GlassPanel'

interface LegendRowProps {
  color: string
  label: string
  size:  number
}

function LegendRow({ color, label, size }: LegendRowProps) {
  const outer = size + 4   // glow ring radius
  const svgSz = outer * 2 + 2
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {/* Dot + faint glow ring */}
      <svg width={svgSz} height={svgSz} style={{ flexShrink: 0 }}>
        {/* Outer glow ring */}
        <circle
          cx={svgSz / 2}
          cy={svgSz / 2}
          r={outer}
          fill={`${color}18`}
          stroke={`${color}30`}
          strokeWidth={0.75}
        />
        {/* Core dot */}
        <circle
          cx={svgSz / 2}
          cy={svgSz / 2}
          r={size}
          fill={color}
          opacity={0.92}
        />
      </svg>
      <span
        style={{
          fontSize:   11,
          fontFamily: 'var(--font-mono)',
          color:      'var(--text-secondary)',
          whiteSpace: 'nowrap',
        }}
      >
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
      transition={{ duration: 0.5, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}
    >
      <GlassPanel intensity="light" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span
          style={{
            fontSize:      10,
            fontWeight:    700,
            fontFamily:    'var(--font-mono)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color:         'var(--text-tertiary)',
            marginBottom:   2,
          }}
        >
          Magnitude
        </span>
        <LegendRow color="#c0392b" label="M6+ Major"     size={7}   />
        <LegendRow color="#ef9f27" label="M4–6 Moderate" size={5}   />
        <LegendRow color="#639922" label="M&lt;4 Minor"  size={3.5} />
        <span
          style={{
            fontSize:   10,
            fontFamily: 'var(--font-mono)',
            color:      'var(--text-tertiary)',
            marginTop:   2,
          }}
        >
          size ∝ magnitude
        </span>
      </GlassPanel>
    </motion.div>
  )
}
