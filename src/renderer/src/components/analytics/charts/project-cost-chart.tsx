import React from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from 'recharts'
import { formatCost } from '@shared/utils'
import type { ProjectCost } from '@shared/types'

interface Props {
  data: ProjectCost[]
}

export function ProjectCostChart({ data }: Props): React.JSX.Element {
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No project data</p>
  }

  const sorted = [...data].sort((a, b) => b.totalCost - a.totalCost).slice(0, 10)

  return (
    <ResponsiveContainer width="100%" height={Math.max(180, sorted.length * 36)}>
      <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 60, left: 4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border" />
        <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v: number) => formatCost(v)} />
        <YAxis
          dataKey="projectName"
          type="category"
          tick={{ fontSize: 10 }}
          width={120}
          tickFormatter={(v: string) => (v.length > 18 ? v.slice(-18) : v)}
        />
        <Tooltip
          formatter={(v: number) => [formatCost(v), 'Cost']}
          contentStyle={{ fontSize: 11 }}
        />
        <Bar dataKey="totalCost" fill="#6366f1" radius={[0, 2, 2, 0]}>
          <LabelList
            dataKey="totalCost"
            position="right"
            formatter={(v: number) => formatCost(v)}
            style={{ fontSize: 10 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
