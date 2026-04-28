import React from 'react'
import { formatCost, formatTokens } from '@shared/utils'
import type { CacheAnalytics } from '@shared/types'

interface Props {
  data: CacheAnalytics
}

export function CacheAnalyticsChart({ data }: Props): React.JSX.Element {
  const hitPct = Math.round(data.hitRatio * 100)

  return (
    <div className="space-y-4">
      {/* Hit ratio gauge */}
      <div className="flex items-center gap-4">
        <div className="relative flex h-20 w-20 shrink-0 items-center justify-center">
          <svg viewBox="0 0 36 36" className="h-20 w-20 -rotate-90">
            <circle
              cx="18"
              cy="18"
              r="15.9"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              className="text-muted/30"
            />
            <circle
              cx="18"
              cy="18"
              r="15.9"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeDasharray={`${hitPct} ${100 - hitPct}`}
              strokeLinecap="round"
              className="text-cyan-500"
            />
          </svg>
          <span className="absolute text-sm font-bold">{hitPct}%</span>
        </div>
        <div className="space-y-1 text-xs">
          <p className="font-medium">Cache Hit Ratio</p>
          <p className="text-muted-foreground">
            Savings:{' '}
            <span className="font-medium text-green-600">{formatCost(data.costSavings)}</span>
          </p>
          <p className="text-muted-foreground">
            5m tokens: {formatTokens(data.totalCache5mTokens)}
          </p>
          <p className="text-muted-foreground">
            1h tokens: {formatTokens(data.totalCache1hTokens)}
          </p>
        </div>
      </div>

      {/* Top session efficiency */}
      {data.sessionEfficiency.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Top Session Efficiency</p>
          <div className="space-y-1">
            {data.sessionEfficiency.slice(0, 5).map((s) => (
              <div key={s.id} className="flex items-center justify-between text-xs">
                <span className="truncate text-muted-foreground" title={s.sessionTitle}>
                  {s.sessionTitle.slice(0, 24)}
                </span>
                <span className="font-medium">{Math.round(s.hitRatio * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
