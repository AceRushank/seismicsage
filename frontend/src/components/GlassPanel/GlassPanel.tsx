import React from 'react'
import styles from './GlassPanel.module.css'

interface GlassPanelProps {
  children: React.ReactNode
  className?: string
  intensity?: 'light' | 'medium' | 'strong'
  style?: React.CSSProperties
}

export function GlassPanel({
  children,
  className = '',
  intensity = 'medium',
  style,
}: GlassPanelProps) {
  return (
    <div
      className={`${styles.glass} ${styles[intensity]} ${className}`}
      style={style}
    >
      {children}
    </div>
  )
}
