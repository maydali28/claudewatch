import React from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from 'recharts'
import { formatCost, formatTokens } from '@shared/utils'
import { StatCard } from '@renderer/components/analytics/stat-card'
import { ChartCard } from '@renderer/components/analytics/chart-card'
import type {
  CacheAnalytics,
  SessionCacheEfficiency,
  ModelCacheSavings,
  SessionCompactionEntry,
} from '@shared/types'

interface Props {
  data: CacheAnalytics
}

// ─── Hit ratio gauge (SVG arc) ────────────────────────────────────────────────

function HitRatioGauge({ hitRatio }: { hitRatio: number }): React.JSX.Element {
  const pct = Math.round(hitRatio * 100)
  const circumference = 2 * Math.PI * 15.9
  const filled = (pct / 100) * circumference

  return (
    <div className="relative flex h-24 w-24 shrink-0 items-center justify-center">
      <svg viewBox="0 0 36 36" className="h-24 w-24 -rotate-90">
        <circle
          cx="18"
          cy="18"
          r="15.9"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          className="text-muted/30"
        />
        <circle
          cx="18"
          cy="18"
          r="15.9"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeDasharray={`${filled} ${circumference - filled}`}
          strokeLinecap="round"
          className={pct >= 60 ? 'text-cyan-500' : pct >= 30 ? 'text-amber-500' : 'text-red-500'}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-lg font-bold leading-none">{pct}%</span>
        <span className="text-[9px] text-muted-foreground">hit rate</span>
      </div>
    </div>
  )
}

// ─── Daily hit ratio line chart ───────────────────────────────────────────────

function DailyHitRatioChart({
  data,
}: {
  data: CacheAnalytics['dailyHitRatio']
}): React.JSX.Element {
  if (data.length === 0) {
    return <p className="py-6 text-center text-xs text-muted-foreground">No daily data</p>
  }

  const chartData = data.map((d) => ({ ...d, ratio: Math.round(d.ratio * 100) }))

  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${v}%`} />
        <Tooltip
          formatter={(v: number) => [`${v}%`, 'Hit Ratio']}
          contentStyle={{ fontSize: 11 }}
        />
        <Line
          type="monotone"
          dataKey="ratio"
          name="Hit Ratio"
          stroke="#06b6d4"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

// ─── Model savings bar chart ───────────────────────────────────────────────────

function ModelSavingsChart({ data }: { data: ModelCacheSavings[] }): React.JSX.Element {
  if (data.length === 0) {
    return <p className="py-6 text-center text-xs text-muted-foreground">No model savings data</p>
  }

  const chartData = [...data].sort((a, b) => b.totalSavings - a.totalSavings)
  const COLORS = ['#06b6d4', '#8b5cf6', '#f59e0b', '#10b981', '#6366f1']

  return (
    <ResponsiveContainer width="100%" height={Math.max(140, chartData.length * 36)}>
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ top: 4, right: 56, left: 4, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border" />
        <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v: number) => formatCost(v)} />
        <YAxis
          dataKey="model"
          type="category"
          tick={{ fontSize: 10 }}
          width={110}
          tickFormatter={(v: string) => (v.length > 16 ? v.slice(-16) : v)}
        />
        <Tooltip
          formatter={(v: number) => [formatCost(v), 'Savings']}
          contentStyle={{ fontSize: 11 }}
        />
        <Bar dataKey="totalSavings" radius={[0, 2, 2, 0]}>
          {chartData.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── Session efficiency table ─────────────────────────────────────────────────

function SessionEfficiencyTable({ rows }: { rows: SessionCacheEfficiency[] }): React.JSX.Element {
  if (rows.length === 0) {
    return <p className="py-4 text-center text-xs text-muted-foreground">No session data</p>
  }

  const sorted = [...rows].sort((a, b) => b.hitRatio - a.hitRatio)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="pb-1.5 text-left font-medium">Session</th>
            <th className="pb-1.5 text-right font-medium">Hit Rate</th>
            <th className="pb-1.5 text-right font-medium">Cache Read</th>
            <th className="pb-1.5 text-right font-medium">Savings</th>
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, 15).map((s) => {
            const pct = Math.round(s.hitRatio * 100)
            return (
              <tr key={s.id} className="border-b last:border-0 hover:bg-muted/40">
                <td
                  className="max-w-[180px] truncate py-1.5 pr-3 font-medium"
                  title={s.sessionTitle}
                >
                  {s.sessionTitle}
                </td>
                <td className="py-1.5 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${pct >= 60 ? 'bg-cyan-500' : pct >= 30 ? 'bg-amber-500' : 'bg-red-400'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-8 text-right">{pct}%</span>
                  </div>
                </td>
                <td className="py-1.5 text-right text-muted-foreground">
                  {formatTokens(s.cacheReadTokens)}
                </td>
                <td className="py-1.5 text-right font-semibold text-green-600">
                  {formatCost(s.savingsAmount)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Compaction pressure table ────────────────────────────────────────────────

function CompactionTable({ rows }: { rows: SessionCompactionEntry[] }): React.JSX.Element {
  if (rows.length === 0) {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground">
        No compactions in this period
      </p>
    )
  }

  const maxRemoved = Math.max(...rows.map((r) => r.totalTokensRemoved), 1)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="pb-1.5 text-left font-medium">Session</th>
            <th className="pb-1.5 text-right font-medium">Compactions</th>
            <th className="pb-1.5 text-right font-medium">Tokens removed</th>
            <th className="pb-1.5 text-right font-medium">Cost avoided</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pct = Math.min(100, (r.totalTokensRemoved / maxRemoved) * 100)
            return (
              <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                <td
                  className="max-w-[180px] truncate py-1.5 pr-3 font-medium"
                  title={r.sessionTitle}
                >
                  {r.sessionTitle}
                </td>
                <td className="py-1.5 text-right text-muted-foreground">{r.compactionCount}</td>
                <td className="py-1.5 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-amber-500/70"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-12 text-right text-muted-foreground">
                      {formatTokens(r.totalTokensRemoved)}
                    </span>
                  </div>
                </td>
                <td className="py-1.5 text-right font-semibold text-green-600">
                  {formatCost(r.estimatedCostAvoided)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Tab root ─────────────────────────────────────────────────────────────────

export function CacheTab({ data }: Props): React.JSX.Element {
  const savings = data.costSavings
  const uncached = data.hypotheticalUncachedCost
  const savingsPct = uncached > 0 ? Math.round((savings / uncached) * 100) : 0

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Cache Hit Rate"
          value={`${Math.round(data.hitRatio * 100)}%`}
          subtitle="of all input tokens"
        />
        <StatCard
          label="Cost Savings"
          value={formatCost(savings)}
          subtitle={`${savingsPct}% vs uncached`}
          deltaPositive
        />
        <StatCard
          label="Cache Reads"
          value={formatTokens(data.totalCacheReadTokens)}
          subtitle="tokens served from cache"
        />
        <StatCard
          label="Read / Write Ratio"
          value={`${data.averageReuseRate.toFixed(1)}×`}
          subtitle="read tokens per written token"
        />
      </div>

      {/* Gauge + tier breakdown */}
      <ChartCard title="Cache Overview" description="Hit ratio across the selected period">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <HitRatioGauge hitRatio={data.hitRatio} />

          <div className="flex-1 space-y-2">
            {/* Cost breakdown */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md bg-muted p-2">
                <p className="text-muted-foreground">Actual cost</p>
                <p className="font-bold">{formatCost(data.actualCost)}</p>
              </div>
              <div className="rounded-md bg-muted p-2">
                <p className="text-muted-foreground">Without cache</p>
                <p className="font-bold">{formatCost(uncached)}</p>
              </div>
            </div>

            {/* Tier breakdown */}
            <div className="rounded-md border p-2 space-y-1 text-xs">
              <p className="font-medium text-muted-foreground">Cache tiers</p>
              <div className="flex justify-between">
                <span className="text-muted-foreground">5-min tier tokens</span>
                <span className="font-medium">{formatTokens(data.totalCache5mTokens)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">1-hour tier tokens</span>
                <span className="font-medium">{formatTokens(data.totalCache1hTokens)}</span>
              </div>
              <div className="flex justify-between border-t pt-1">
                <span className="text-muted-foreground">5-min tier cost</span>
                <span className="font-medium">{formatCost(data.tierCostBreakdown.cost5m)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">1-hour tier cost</span>
                <span className="font-medium">{formatCost(data.tierCostBreakdown.cost1h)}</span>
              </div>
            </div>
          </div>
        </div>
      </ChartCard>

      {/* Daily hit ratio trend */}
      <ChartCard title="Daily Hit Ratio Trend" description="How cache efficiency evolves over time">
        <DailyHitRatioChart data={data.dailyHitRatio} />
        {data.cacheBustingDays.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Cache-busting days:{' '}
            <span className="font-medium text-amber-500">
              {data.cacheBustingDays.slice(0, 5).join(', ')}
              {data.cacheBustingDays.length > 5 && ` +${data.cacheBustingDays.length - 5} more`}
            </span>
          </p>
        )}
      </ChartCard>

      {/* Model savings */}
      {data.modelSavings.length > 0 && (
        <ChartCard title="Savings by Model" description="Which models benefit most from caching">
          <ModelSavingsChart data={data.modelSavings} />
        </ChartCard>
      )}

      {/* Session efficiency table */}
      <ChartCard
        title="Session Cache Efficiency"
        description="Top sessions ranked by cache hit rate"
      >
        <SessionEfficiencyTable rows={data.sessionEfficiency} />
      </ChartCard>

      {/* Compaction / context pressure */}
      <ChartCard
        title="Context Pressure"
        description="Sessions where Claude compacted the conversation to free context window space"
        action={
          <div className="flex gap-3 text-xs text-muted-foreground">
            <span>
              <span className="font-semibold text-foreground">
                {data.compactionAnalytics.totalCompactions}
              </span>{' '}
              compactions
            </span>
            <span>
              <span className="font-semibold text-foreground">
                {formatTokens(data.compactionAnalytics.totalTokensRemoved)}
              </span>{' '}
              tokens removed
            </span>
            <span className="font-semibold text-green-600">
              {formatCost(data.compactionAnalytics.estimatedCostAvoided)} avoided
            </span>
          </div>
        }
      >
        {/* KPI strip */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="rounded-md bg-muted p-2 text-xs">
            <p className="text-muted-foreground mb-0.5">Total compactions</p>
            <p className="font-bold text-sm">{data.compactionAnalytics.totalCompactions}</p>
          </div>
          <div className="rounded-md bg-muted p-2 text-xs">
            <p className="text-muted-foreground mb-0.5">Avg tokens removed</p>
            <p className="font-bold text-sm">
              {formatTokens(data.compactionAnalytics.avgTokensRemovedPerSession)}
            </p>
            <p className="text-muted-foreground">per affected session</p>
          </div>
          <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-2 text-xs">
            <p className="text-muted-foreground mb-0.5">Est. cost avoided</p>
            <p className="font-bold text-sm text-green-600">
              {formatCost(data.compactionAnalytics.estimatedCostAvoided)}
            </p>
            <p className="text-muted-foreground">vs re-sending all tokens</p>
          </div>
        </div>
        <CompactionTable rows={data.compactionAnalytics.topSessions} />
      </ChartCard>
    </div>
  )
}
