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
import { formatCost } from '@shared/utils'
import { StatCard } from '@renderer/components/analytics/stat-card'
import { ChartCard } from '@renderer/components/analytics/chart-card'
import { ParallelToolsChart } from '@renderer/components/analytics/charts/parallel-tools-chart'
import type { AnalyticsData, EffortAnalytics, DailyEffort } from '@shared/types'

// ─── Colour palette per effort level ─────────────────────────────────────────

const EFFORT_COLORS: Record<string, string> = {
  low: '#10b981',
  medium: '#f59e0b',
  high: '#ef4444',
  ultrathink: '#8b5cf6',
}

const EFFORT_ORDER = ['low', 'medium', 'high', 'ultrathink'] as const

// ─── Stacked effort-over-time chart ───────────────────────────────────────────

function EffortOverTimeChart({ data }: { data: DailyEffort[] }): React.JSX.Element {
  if (data.length === 0) {
    return <p className="py-6 text-center text-xs text-muted-foreground">No daily effort data</p>
  }

  const chartData = data.map((d) => ({
    date: d.date,
    low: d.distribution.low ?? 0,
    medium: d.distribution.medium ?? 0,
    high: d.distribution.high ?? 0,
    ultrathink: d.distribution.ultrathink ?? 0,
  }))

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} />
        <YAxis tick={{ fontSize: 10 }} />
        <Tooltip contentStyle={{ fontSize: 11 }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {EFFORT_ORDER.map((level) => (
          <Bar
            key={level}
            dataKey={level}
            name={level.charAt(0).toUpperCase() + level.slice(1)}
            stackId="a"
            fill={EFFORT_COLORS[level]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── Effort cost breakdown table ──────────────────────────────────────────────

function EffortCostTable({ data }: { data: EffortAnalytics }): React.JSX.Element {
  if (data.costByEffort.length === 0) {
    return <p className="py-4 text-center text-xs text-muted-foreground">No cost data</p>
  }

  const totalCost = data.costByEffort.reduce((s, r) => s + r.totalCost, 0)
  const totalTurns = data.costByEffort.reduce((s, r) => s + r.turnCount, 0)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="pb-1.5 text-left font-medium">Level</th>
            <th className="pb-1.5 text-right font-medium">Turns</th>
            <th className="pb-1.5 text-right font-medium">Share</th>
            <th className="pb-1.5 text-right font-medium">Total Cost</th>
            <th className="pb-1.5 text-right font-medium">Cost / Turn</th>
          </tr>
        </thead>
        <tbody>
          {EFFORT_ORDER.map((level) => {
            const row = data.costByEffort.find((r) => r.level === level)
            if (!row) return null
            const turnShare = totalTurns > 0 ? (row.turnCount / totalTurns) * 100 : 0
            const _costShare = totalCost > 0 ? (row.totalCost / totalCost) * 100 : 0
            return (
              <tr key={row.id} className="border-b last:border-0 hover:bg-muted/40">
                <td className="py-1.5 pr-3">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ background: EFFORT_COLORS[level] }}
                    />
                    <span className="capitalize font-medium">{level}</span>
                  </div>
                </td>
                <td className="py-1.5 text-right">{row.turnCount.toLocaleString()}</td>
                <td className="py-1.5 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${turnShare}%`, background: EFFORT_COLORS[level] }}
                      />
                    </div>
                    <span className="w-8 text-right text-muted-foreground">
                      {turnShare.toFixed(0)}%
                    </span>
                  </div>
                </td>
                <td className="py-1.5 text-right font-semibold">{formatCost(row.totalCost)}</td>
                <td className="py-1.5 text-right text-muted-foreground">
                  {formatCost(row.avgCostPerTurn)}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="border-t font-semibold">
            <td className="py-1.5 text-muted-foreground">Total</td>
            <td className="py-1.5 text-right">{totalTurns.toLocaleString()}</td>
            <td />
            <td className="py-1.5 text-right">{formatCost(totalCost)}</td>
            <td />
          </tr>
          <tr>
            <td colSpan={5} className="pt-1 text-[10px] text-muted-foreground/60">
              Cost excludes subagent spend — effort level is tracked on parent turns only.
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ─── Effort distribution donut (custom SVG arcs) ──────────────────────────────

function EffortDonut({
  distribution,
}: {
  distribution: EffortAnalytics['distribution']
}): React.JSX.Element {
  const pieData = EFFORT_ORDER.map((level) => ({ level, value: distribution[level] ?? 0 })).filter(
    (d) => d.value > 0
  )

  if (pieData.length === 0) {
    return <p className="py-6 text-center text-xs text-muted-foreground">No effort data</p>
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={pieData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis
          dataKey="level"
          tick={{ fontSize: 10 }}
          tickFormatter={(v: string) => v.charAt(0).toUpperCase() + v.slice(1)}
        />
        <YAxis tick={{ fontSize: 10 }} />
        <Tooltip
          formatter={(v: number, name: string) => [v, name]}
          contentStyle={{ fontSize: 11 }}
        />
        <Bar dataKey="value" name="Turns" radius={[2, 2, 0, 0]}>
          {pieData.map((d, i) => (
            <Cell key={i} fill={EFFORT_COLORS[d.level]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── Tab root ─────────────────────────────────────────────────────────────────

interface Props {
  data: AnalyticsData
}

export function EffortTab({ data }: Props): React.JSX.Element {
  const { effortAnalytics, parallelToolAnalytics } = data
  const dist = effortAnalytics.distribution
  const totalTurns = EFFORT_ORDER.reduce((s, l) => s + (dist[l] ?? 0), 0)

  const ultrathinkPct = totalTurns > 0 ? Math.round(((dist.ultrathink ?? 0) / totalTurns) * 100) : 0
  const highPct = totalTurns > 0 ? Math.round(((dist.high ?? 0) / totalTurns) * 100) : 0
  const totalEffortCost = effortAnalytics.costByEffort.reduce((s, r) => s + r.totalCost, 0)
  const ultrathinkCost =
    effortAnalytics.costByEffort.find((r) => r.level === 'ultrathink')?.totalCost ?? 0

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Total Turns"
          value={totalTurns.toLocaleString()}
          subtitle="parent session turns only"
        />
        <StatCard
          label="Ultrathink Turns"
          value={`${ultrathinkPct}%`}
          subtitle={`${(dist.ultrathink ?? 0).toLocaleString()} turns`}
        />
        <StatCard
          label="High Effort"
          value={`${highPct}%`}
          subtitle={`${(dist.high ?? 0).toLocaleString()} turns`}
        />
        <StatCard
          label="Ultrathink Cost"
          value={formatCost(ultrathinkCost)}
          subtitle={`${totalEffortCost > 0 ? ((ultrathinkCost / totalEffortCost) * 100).toFixed(0) : 0}% of effort cost`}
        />
      </div>

      {/* Distribution chart + cost table */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Effort Distribution" description="Turn counts by effort level">
          <EffortDonut distribution={dist} />
        </ChartCard>
        <ChartCard title="Cost by Effort Level" description="Spend and cost-per-turn breakdown">
          <EffortCostTable data={effortAnalytics} />
        </ChartCard>
      </div>

      {/* Effort over time */}
      <ChartCard title="Effort Over Time" description="Daily stacked turn counts by effort level">
        <EffortOverTimeChart data={effortAnalytics.effortOverTime} />
      </ChartCard>

      {/* Parallel tool usage */}
      <ChartCard
        title="Parallel Tool Usage"
        description="Distribution of how many tools Claude runs in parallel per turn"
      >
        <ParallelToolsChart data={parallelToolAnalytics} />
      </ChartCard>
    </div>
  )
}
