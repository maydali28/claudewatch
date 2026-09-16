import React from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { formatTokens } from '@shared/utils'
import type { DailyUsage } from '@shared/types'

interface Props {
  data: DailyUsage[]
}

export function DailyUsageChart({ data }: Props): React.JSX.Element {
  // Every bounded preset (`today`/`7d`/`30d`/custom, up to the span cap —
  // see `analytics-engine.ts`) zero-fills `dailyUsage`, but that fill clamps
  // to today (manufacturing future zeros would be dishonest), so
  // `data.length === 0` can still happen for three cases: `all` with no
  // history at all (never zero-filled — see `computeAnalytics`), a custom
  // range wide enough to hit the span cap, and a custom range that lies
  // entirely after today — reachable, because the date picker's `endMonth`
  // stops month *navigation* past the current one but does not disable
  // future days within it. The first two reach this by skipping the fill and
  // falling back to the sparse, observed-days-only series `all` always had;
  // the third still RUNS the fill (clamped to today, its key range is empty,
  // so it passes the span cap) and the fill simply has nothing to add.
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No data for this period</p>
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10 }}
          tickFormatter={(v: string) => v.slice(5)}
          className="fill-muted-foreground"
        />
        <YAxis
          tick={{ fontSize: 10 }}
          tickFormatter={(v: number) => formatTokens(v)}
          className="fill-muted-foreground"
        />
        <Tooltip
          formatter={(v, name) => [formatTokens(Number(v)), String(name)]}
          contentStyle={{ fontSize: 11 }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="inputTokens" name="Input" stackId="a" fill="#6366f1" />
        <Bar dataKey="outputTokens" name="Output" stackId="a" fill="#8b5cf6" />
        <Bar
          dataKey="cacheReadTokens"
          name="Cache Read"
          stackId="a"
          fill="#06b6d4"
          radius={[2, 2, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}
