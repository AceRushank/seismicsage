import { AnimatePresence, motion } from 'framer-motion'
import { GlassPanel } from './GlassPanel/GlassPanel'
import type { FaultFeature } from './Globe/EarthGlobe'

// ─── Label maps ──────────────────────────────────────────────────────────────

const TYPE_LABEL: Record<string, string> = {
  subduction: 'Subduction boundary',
  transform:  'Transform boundary',
  spreading:  'Spreading boundary',
  default:    'Plate boundary',
}

const TYPE_SUB: Record<string, string> = {
  subduction: 'Strike-dip · High seismic risk',
  transform:  'Strike-slip · High seismic risk',
  spreading:  'Divergent · Moderate seismic risk',
  default:    'Plate boundary',
}

const TYPE_COLOR: Record<string, string> = {
  subduction: '#dc3c28',
  transform:  '#dc8c1e',
  spreading:  '#3c8cc8',
  default:    '#966432',
}

// ─── Component ───────────────────────────────────────────────────────────────

interface FaultTooltipProps {
  fault: FaultFeature | null
  x: number
  y: number
}

export function FaultTooltip({ fault, x, y }: FaultTooltipProps) {
  const boundaryType = fault?.boundaryType ?? 'default'
  const label = TYPE_LABEL[boundaryType] ?? TYPE_LABEL.default
  const sub   = TYPE_SUB[boundaryType]   ?? TYPE_SUB.default
  const color = TYPE_COLOR[boundaryType] ?? TYPE_COLOR.default

  return (
    <AnimatePresence>
      {fault && (
        <motion.div
          key="fault-tooltip"
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.92 }}
          transition={{ duration: 0.1, ease: 'easeOut' }}
          style={{
            position: 'fixed',
            left: x + 14,
            top: y + 14,
            zIndex: 200,
            pointerEvents: 'none',
            maxWidth: 200,
          }}
        >
          <GlassPanel
            intensity="light"
            style={{ padding: '8px 12px', borderRadius: 12 }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color,
                letterSpacing: '-0.01em',
                marginBottom: 2,
              }}
            >
              {label}
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-secondary)',
              }}
            >
              {sub}
            </div>
          </GlassPanel>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
