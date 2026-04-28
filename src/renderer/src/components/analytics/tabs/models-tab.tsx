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
  Cell,
} from 'recharts'
import { formatCost, formatTokens } from '@shared/utils'
import { getModelMeta } from '@renderer/lib/model-meta'
import { StatCard } from '@renderer/components/analytics/stat-card'
import { ChartCard } from '@renderer/components/analytics/chart-card'
import { ModelDistributionChart } from '@renderer/components/analytics/charts/model-distribution-chart'
import { ModelEfficiencyTable } from '@renderer/components/analytics/charts/model-efficiency-table'
import { DailyModelCostChart } from '@renderer/components/analytics/charts/daily-model-cost-chart'
import { WhatIfCalculator } from '@renderer/components/analytics/charts/whatif-calculator'
import type { AnalyticsData } from '@shared/types'

interface Props {
  data: AnalyticsData
}

// ─── Input/Output token breakdown per model ───────────────────────────────────

function ModelTokensChart({ data }: Pick<Props, 'data'>): React.JSX.Element {
  if (data.modelUsage.length === 0) {
    return <p className="py-6 text-center text-xs text-muted-foreground">No model data</p>
  }

  const chartData = data.modelUsage.map((m) => {
    const meta = getModelMeta(m.model)
    return {
      name: meta.label,
      input: m.totalInputTokens,
      output: m.totalOutputTokens,
      color: meta.color,
    }
  })

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="name" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => formatTokens(v)} />
        <Tooltip
          formatter={(v: number, name: string) => [formatTokens(v), name]}
          contentStyle={{ fontSize: 11 }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="input" name="Input" stackId="a" fill="#6366f1" />
        <Bar dataKey="output" name="Output" stackId="a" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── Cost per model bar chart ─────────────────────────────────────────────────

function ModelCostBars({ data }: Pick<Props, 'data'>): React.JSX.Element {
  if (data.modelEfficiency.length === 0) {
    return <p className="py-6 text-center text-xs text-muted-foreground">No cost data</p>
  }

  const chartData = [...data.modelEfficiency]
    .sort((a, b) => b.totalCost - a.totalCost)
    .map((m) => {
      const meta = getModelMeta(m.model)
      return { name: meta.label, cost: m.totalCost, color: meta.color }
    })

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="name" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => formatCost(v)} />
        <Tooltip
          formatter={(v: number) => [formatCost(v), 'Cost']}
          contentStyle={{ fontSize: 11 }}
        />
        <Bar dataKey="cost" radius={[2, 2, 0, 0]}>
          {chartData.map((d, i) => (
            <Cell key={i} fill={d.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── Tab root ─────────────────────────────────────────────────────────────────

export function ModelsTab({ data }: Props): React.JSX.Element {
  const totalTurns = data.modelUsage.reduce((s, m) => s + m.turnCount, 0)
  const dominantModel = [...data.modelUsage].sort((a, b) => b.turnCount - a.turnCount)[0]
  const dominantMeta = dominantModel ? getModelMeta(dominantModel.model) : null
  const dominantPct =
    totalTurns > 0 && dominantModel ? Math.round((dominantModel.turnCount / totalTurns) * 100) : 0

  const _mostExpensive = [...data.modelEfficiency].sort((a, b) => b.totalCost - a.totalCost)[0]
  const mostEfficientByCost = [...data.modelEfficiency]
    .filter((m) => m.turnCount >= 5)
    .sort((a, b) => a.costPerTurn - b.costPerTurn)[0]

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Model Families"
          value={data.modelUsage.length.toString()}
          subtitle="in use this period"
        />
        <StatCard
          label="Total Turns"
          value={totalTurns.toLocaleString()}
          subtitle="across all models"
        />
        {dominantMeta && (
          <StatCard
            label="Primary Model"
            value={dominantMeta.label}
            subtitle={`${dominantPct}% of turns`}
          />
        )}
        {mostEfficientByCost && (
          <StatCard
            label="Most Efficient"
            value={getModelMeta(mostEfficientByCost.model).label}
            subtitle={`${formatCost(mostEfficientByCost.costPerTurn)}/turn`}
            deltaPositive
          />
        )}
      </div>

      {/* Distribution + cost side by side */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Turn Distribution" description="Share of total turns per model">
          <ModelDistributionChart data={data.modelUsage} />
        </ChartCard>
        <ChartCard title="Cost by Model" description="Total spend per model family">
          <ModelCostBars data={data} />
        </ChartCard>
      </div>

      {/* Token breakdown */}
      <ChartCard title="Input vs Output Tokens" description="Token composition per model">
        <ModelTokensChart data={data} />
      </ChartCard>

      {/* Daily cost over time */}
      <ChartCard title="Daily Cost by Model" description="Spend trend stacked by model">
        <DailyModelCostChart data={data.dailyModelCost} />
      </ChartCard>

      {/* Efficiency table */}
      <ChartCard
        title="Model Efficiency"
        description="Cost per turn, output tokens, and share of total cost — click columns to sort"
      >
        <ModelEfficiencyTable data={data.modelEfficiency} />
      </ChartCard>

      {/* What-if calculator */}
      <ChartCard
        title="What-If Calculator"
        description="Estimate cost impact of routing work to a different model"
      >
        <WhatIfCalculator data={data.modelEfficiency} />
      </ChartCard>
    </div>
  )
}
