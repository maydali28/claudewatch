import React from 'react'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { formatCost } from '@shared/utils'
import type { EffortAnalytics } from '@shared/types'

const EFFORT_COLORS: Record<string, string> = {
  low: '#10b981',
  medium: '#f59e0b',
  high: '#ef4444',
  ultrathink: '#8b5cf6',
}

interface Props {
  data: EffortAnalytics
}

export function EffortChart({ data }: Props): React.JSX.Element {
  const pieData = Object.entries(data.distribution)
    .filter(([, v]) => v > 0)
    .map(([level, count]) => ({ name: level, value: count }))

  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie
            data={pieData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={45}
            outerRadius={72}
            paddingAngle={2}
          >
            {pieData.map((entry, i) => (
              <Cell key={i} fill={EFFORT_COLORS[entry.name] ?? '#6366f1'} />
            ))}
          </Pie>
          <Tooltip contentStyle={{ fontSize: 11 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>

      {/* Cost by effort */}
      {data.costByEffort.length > 0 && (
        <div className="space-y-1">
          {data.costByEffort.map((row) => (
            <div key={row.id} className="flex items-center justify-between text-xs">
              <span className="capitalize text-muted-foreground">{row.level}</span>
              <div className="flex gap-3">
                <span>{row.turnCount} turns</span>
                <span className="font-medium">{formatCost(row.totalCost)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
