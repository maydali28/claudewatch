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
          formatter={(v: number, name: string) => [formatTokens(v), name]}
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
