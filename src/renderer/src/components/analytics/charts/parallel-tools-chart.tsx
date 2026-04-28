import React from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import type { ParallelToolAnalytics } from '@shared/types'

interface Props {
  data: ParallelToolAnalytics
}

export function ParallelToolsChart({ data }: Props): React.JSX.Element {
  if (data.distribution.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No parallel tool data</p>
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md bg-muted p-2">
          <p className="text-xs text-muted-foreground">Total Groups</p>
          <p className="text-sm font-bold">{data.totalParallelGroups}</p>
        </div>
        <div className="rounded-md bg-muted p-2">
          <p className="text-xs text-muted-foreground">Avg Tools</p>
          <p className="text-sm font-bold">{data.avgToolsPerGroup.toFixed(1)}</p>
        </div>
        <div className="rounded-md bg-muted p-2">
          <p className="text-xs text-muted-foreground">Max Degree</p>
          <p className="text-sm font-bold">{data.maxParallelDegree}</p>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data.distribution} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="toolCount"
            tick={{ fontSize: 10 }}
            label={{ value: 'Tools', position: 'insideBottom', fontSize: 10, offset: -2 }}
          />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip
            formatter={(v: number) => [v, 'Occurrences']}
            labelFormatter={(l) => `${l} tools`}
            contentStyle={{ fontSize: 11 }}
          />
          <Bar dataKey="occurrences" name="Occurrences" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
