import React from 'react'
import { cn } from '@renderer/lib/cn'

interface HealthScoreGaugeProps {
  score: number // 0.0–1.0
  size?: number // px, default 120
}

function getLabel(pct: number): string {
  if (pct >= 80) return 'Excellent'
  if (pct >= 50) return 'Good'
  if (pct >= 25) return 'Fair'
  return 'Poor'
}

function getColor(pct: number): string {
  if (pct >= 80) return '#22c55e' // green-500
  if (pct >= 50) return '#f59e0b' // amber-500
  return '#ef4444' // red-500
}

export function HealthScoreGauge({ score, size = 120 }: HealthScoreGaugeProps): React.JSX.Element {
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100)
  const color = getColor(pct)
  const label = getLabel(pct)

  // SVG arc: semi-circle gauge (180°)
  const R = 40
  const cx = 60
  const cy = 55
  const strokeWidth = 10
  const circumference = Math.PI * R // half-circle arc length

  // Background arc
  const bgPath = `M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`
  // Foreground arc (clipped by score)
  const dashLen = (pct / 100) * circumference
  const dashGap = circumference - dashLen

  return (
    <div className="flex flex-col items-center gap-1" style={{ width: size }}>
      <svg
        viewBox="0 0 120 70"
        width={size}
        height={(size * 70) / 120}
        aria-label={`Health score: ${pct}%`}
      >
        {/* Background track */}
        <path
          d={bgPath}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          className="text-muted/40"
        />
        {/* Score arc */}
        <path
          d={bgPath}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${dashLen} ${dashGap}`}
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
        {/* Center text */}
        <text
          x={cx}
          y={cy + 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="16"
          fontWeight="700"
          fill={color}
        >
          {pct}
        </text>
        <text
          x={cx}
          y={cy + 16}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="8"
          fill="currentColor"
          className="text-muted-foreground"
          opacity={0.6}
        >
          %
        </text>
      </svg>
      <span
        className={cn(
          'text-xs font-semibold',
          pct >= 80 ? 'text-green-500' : pct >= 50 ? 'text-amber-500' : 'text-red-500'
        )}
      >
        {label}
      </span>
    </div>
  )
}
