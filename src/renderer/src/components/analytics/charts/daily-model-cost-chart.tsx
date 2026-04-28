import React from 'react'
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import { formatCost } from '@shared/utils'
import { getModelMeta } from '@renderer/lib/model-meta'
import type { DailyModelCost } from '@shared/types'

interface Props {
  data: DailyModelCost[]
}

export function DailyModelCostChart({ data }: Props): React.JSX.Element {
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No data for this period</p>
  }

  // Collect all unique dates and models
  const dateSet = new Set<string>()
  const modelSet = new Set<string>()
  for (const row of data) {
    dateSet.add(row.date)
    modelSet.add(row.model)
  }

  const dates = Array.from(dateSet).sort()
  const modelList = Array.from(modelSet)

  // Pivot: date → { [model]: cost } — zero-fill missing model/date combos
  const pivotMap = new Map<string, Record<string, number>>()
  for (const date of dates) {
    const entry: Record<string, number> = { date: date as unknown as number }
    for (const model of modelList) entry[model] = 0
    pivotMap.set(date, entry)
  }
  for (const row of data) {
    pivotMap.get(row.date)![row.model] = row.cost
  }

  const chartData = dates.map((date) => ({ date, ...pivotMap.get(date) }))

  // Single date: horizontal bar per model (no time axis needed)
  if (dates.length === 1) {
    const bars = modelList
      .map((model) => ({
        model,
        cost: pivotMap.get(dates[0])![model] ?? 0,
        ...getModelMeta(model),
      }))
      .filter((b) => b.cost > 0)
      .sort((a, b) => b.cost - a.cost)

    if (bars.length === 0) {
      return (
        <p className="py-8 text-center text-sm text-muted-foreground">No data for this period</p>
      )
    }

    return (
      <ResponsiveContainer width="100%" height={Math.max(100, bars.length * 40)}>
        <BarChart
          data={bars}
          layout="vertical"
          margin={{ top: 4, right: 64, left: 8, bottom: 0 }}
          barCategoryGap="30%"
        >
          <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border" />
          <XAxis
            type="number"
            tick={{ fontSize: 10 }}
            tickFormatter={(v: number) => formatCost(v)}
          />
          <YAxis dataKey="label" type="category" tick={{ fontSize: 10 }} width={80} />
          <Tooltip
            formatter={(v: number) => [formatCost(v), 'Cost']}
            contentStyle={{ fontSize: 11 }}
          />
          <Bar
            dataKey="cost"
            radius={[0, 3, 3, 0]}
            label={{ position: 'right', fontSize: 10, formatter: (v: number) => formatCost(v) }}
          >
            {bars.map((b, i) => (
              <Cell key={i} fill={b.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    )
  }

  // Few dates (≤ 10): grouped bar chart — avoids misleading area interpolation
  if (dates.length <= 10) {
    return (
      <ResponsiveContainer width="100%" height={220}>
        <BarChart
          data={chartData}
          margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
          barCategoryGap="20%"
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} />
          <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => formatCost(v)} width={52} />
          <Tooltip
            formatter={(v: number, name: string) => [formatCost(v), getModelMeta(name).label]}
            contentStyle={{ fontSize: 11 }}
          />
          <Legend
            wrapperStyle={{ fontSize: 10 }}
            formatter={(name: string) => getModelMeta(name).label}
          />
          {modelList.map((model) => {
            const { color } = getModelMeta(model)
            return (
              <Bar
                key={model}
                dataKey={model}
                stackId="stack"
                fill={color}
                fillOpacity={0.85}
                radius={[0, 0, 0, 0]}
              />
            )
          })}
        </BarChart>
      </ResponsiveContainer>
    )
  }

  // Many dates (> 10): stacked area chart — good for trend visibility
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} />
        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => formatCost(v)} width={52} />
        <Tooltip
          formatter={(v: number, name: string) => [formatCost(v), getModelMeta(name).label]}
          contentStyle={{ fontSize: 11 }}
        />
        <Legend
          wrapperStyle={{ fontSize: 10 }}
          formatter={(name: string) => getModelMeta(name).label}
        />
        {modelList.map((model) => {
          const { color } = getModelMeta(model)
          return (
            <Area
              key={model}
              type="monotone"
              dataKey={model}
              stackId="1"
              fill={color}
              stroke={color}
              fillOpacity={0.6}
            />
          )
        })}
      </AreaChart>
    </ResponsiveContainer>
  )
}
