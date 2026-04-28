import React from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import type { LatencyAnalytics } from '@shared/types'

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

interface Props {
  data: LatencyAnalytics
}

export function LatencyChart({ data }: Props): React.JSX.Element {
  return (
    <div className="space-y-4">
      {/* p-stats */}
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { label: 'p50', value: data.medianDurationMs },
          { label: 'p95', value: data.p95DurationMs },
          { label: 'p99', value: data.p99DurationMs },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-md bg-muted p-2">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-sm font-bold">{fmtMs(value)}</p>
          </div>
        ))}
      </div>

      {/* Histogram */}
      {data.histogram.length > 0 && (
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={data.histogram} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip contentStyle={{ fontSize: 11 }} />
            <Bar dataKey="count" name="Turns" fill="#6366f1" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}

      {/* Slowest turns */}
      {data.slowestTurns.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Slowest Turns</p>
          <div className="space-y-1">
            {data.slowestTurns.slice(0, 5).map((t) => (
              <div key={t.id} className="flex items-center justify-between text-xs">
                <span className="truncate text-muted-foreground" title={t.sessionTitle}>
                  {t.sessionTitle.slice(0, 24)}
                </span>
                <span className="font-medium">{fmtMs(t.durationMs)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
