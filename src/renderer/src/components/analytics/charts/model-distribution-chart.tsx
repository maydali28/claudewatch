import React from 'react'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { getModelMeta } from '@renderer/lib/model-meta'
import type { ModelUsage } from '@shared/types'

interface Props {
  data: ModelUsage[]
}

export function ModelDistributionChart({ data }: Props): React.JSX.Element {
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No model data</p>
  }

  const total = data.reduce((sum, d) => sum + d.turnCount, 0)

  const chartData = data.map((d) => {
    const meta = getModelMeta(d.model)
    return { ...d, name: meta.label, color: meta.color }
  })

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={chartData}
          dataKey="turnCount"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={55}
          outerRadius={85}
          paddingAngle={2}
        >
          {chartData.map((d, i) => (
            <Cell key={i} fill={d.color} />
          ))}
        </Pie>
        <Tooltip
          formatter={(v: number, name: string) => [
            `${v} turns (${total > 0 ? Math.round((v / total) * 100) : 0}%)`,
            name,
          ]}
          contentStyle={{ fontSize: 11 }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  )
}
