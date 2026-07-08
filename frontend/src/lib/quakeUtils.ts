// Shared utility functions for earthquake display logic
// Pure functions — no React dependencies

export function getMagnitudeColor(mag: number): string {
  if (mag >= 6) return '#c0392b'  // red
  if (mag >= 4) return '#ef9f27'  // amber
  return '#639922'                // green
}

export function getMagnitudeTier(mag: number): 'major' | 'moderate' | 'minor' {
  if (mag >= 6) return 'major'
  if (mag >= 4) return 'moderate'
  return 'minor'
}

export function formatRelativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

export function formatMagnitude(mag: number): string {
  return `M${mag.toFixed(1)}`
}
