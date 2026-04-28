import React from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts'
import { Clock, Zap, TrendingUp, AlertTriangle, Timer } from 'lucide-react'
import { useAnalyticsStore } from '@renderer/store/analytics.store'
import { getModelMeta } from '@renderer/lib/model-meta'
import { StatCard } from '@renderer/components/analytics/stat-card'
import { ChartCard } from '@renderer/components/analytics/chart-card'
import type { LatencyAnalytics, SlowTurnEntry } from '@shared/types'

interface Props {
  data: LatencyAnalytics
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  if (ms <= 0) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

function fmtMsShort(ms: number): string {
  if (ms <= 0) return '0'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(0)}s`
}

// ─── Percentile comparison — horizontal bar chart ─────────────────────────────

function PercentilesChart({ data }: { data: LatencyAnalytics }): React.JSX.Element {
  const bars = [
    { label: 'p50 (median)', value: data.medianDurationMs, color: '#10b981' },
    { label: 'Normal avg', value: data.normalAvgMs, color: '#6366f1' },
    { label: 'p95', value: data.p95DurationMs, color: '#f59e0b' },
    { label: 'Post-compact', value: data.postCompactionAvgMs, color: '#8b5cf6' },
    { label: 'p99', value: data.p99DurationMs, color: '#ef4444' },
  ].filter((b) => b.value > 0)

  if (bars.length === 0) {
    return <p className="py-6 text-center text-xs text-muted-foreground">No latency data</p>
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(140, bars.length * 36)}>
      <BarChart
        data={bars}
        layout="vertical"
        margin={{ top: 4, right: 72, left: 8, bottom: 0 }}
        barCategoryGap="28%"
      >
        <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border" />
        <XAxis
          type="number"
          tick={{ fontSize: 10 }}
          tickFormatter={fmtMsShort}
          domain={[0, 'dataMax']}
        />
        <YAxis dataKey="label" type="category" tick={{ fontSize: 11 }} width={90} />
        <Tooltip
          formatter={(v: number) => [fmtMs(v), 'Duration']}
          contentStyle={{ fontSize: 11 }}
        />
        {/* Median reference line */}
        <ReferenceLine
          x={data.medianDurationMs}
          stroke="#10b981"
          strokeDasharray="4 2"
          strokeWidth={1}
        />
        <Bar
          dataKey="value"
          radius={[0, 3, 3, 0]}
          label={{ position: 'right', fontSize: 10, formatter: (v: number) => fmtMs(v) }}
        >
          {bars.map((b, i) => (
            <Cell key={i} fill={b.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── Turn distribution histogram ──────────────────────────────────────────────

const BUCKET_COLORS: Record<string, string> = {
  '0–1s': '#10b981',
  '1–5s': '#6366f1',
  '5–30s': '#f59e0b',
  '30s+': '#ef4444',
}

function LatencyHistogram({ data }: { data: LatencyAnalytics }): React.JSX.Element {
  if (data.histogram.length === 0 || data.histogram.every((b) => b.count === 0)) {
    return <p className="py-6 text-center text-xs text-muted-foreground">No histogram data</p>
  }

  const total = data.histogram.reduce((s, b) => s + b.count, 0)

  return (
    <div className="space-y-3">
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data.histogram} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip
            formatter={(v: number) => [v, 'Turns']}
            labelFormatter={(l) =>
              `${l} — ${total > 0 ? (((data.histogram.find((b) => b.label === l)?.count ?? 0) / total) * 100).toFixed(0) : 0}% of turns`
            }
            contentStyle={{ fontSize: 11 }}
          />
          <Bar dataKey="count" name="Turns" radius={[3, 3, 0, 0]}>
            {data.histogram.map((b, i) => (
              <Cell key={i} fill={BUCKET_COLORS[b.label] ?? '#6366f1'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Legend with share */}
      <div className="flex flex-wrap gap-3">
        {data.histogram.map((b) => {
          const pct = total > 0 ? ((b.count / total) * 100).toFixed(0) : '0'
          const color = BUCKET_COLORS[b.label] ?? '#6366f1'
          return (
            <div key={b.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
              <span>{b.label}</span>
              <span className="font-semibold text-foreground">{b.count}</span>
              <span className="opacity-60">({pct}%)</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Normal vs post-compaction comparison ─────────────────────────────────────

function CompactionComparison({ data }: { data: LatencyAnalytics }): React.JSX.Element {
  const hasCompaction = data.postCompactionAvgMs > 0 && data.normalAvgMs > 0
  const ratio = hasCompaction ? data.postCompactionAvgMs / data.normalAvgMs : 0
  const isSignificant = ratio >= 1.5
  const maxMs = Math.max(data.normalAvgMs, data.postCompactionAvgMs, 1)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 text-xs">
        {/* Normal avg */}
        <div className="rounded-lg border border-border/50 bg-muted/30 p-3">
          <div className="flex items-center gap-1.5 mb-2 text-muted-foreground">
            <Zap className="h-3 w-3" />
            <span className="font-medium">Normal turns</span>
          </div>
          <p className="text-2xl font-bold tabular-nums">{fmtMs(data.normalAvgMs)}</p>
          <p className="mt-0.5 text-muted-foreground">average turn duration</p>
          {/* Bar */}
          <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-indigo-500"
              style={{ width: `${(data.normalAvgMs / maxMs) * 100}%` }}
            />
          </div>
        </div>

        {/* Post-compaction avg */}
        <div
          className={`rounded-lg border p-3 ${isSignificant ? 'border-amber-500/40 bg-amber-500/5' : 'border-border/50 bg-muted/30'}`}
        >
          <div className="flex items-center gap-1.5 mb-2 text-muted-foreground">
            <TrendingUp className="h-3 w-3" />
            <span className="font-medium">Post-compaction</span>
          </div>
          <p className={`text-2xl font-bold tabular-nums ${isSignificant ? 'text-amber-500' : ''}`}>
            {hasCompaction ? fmtMs(data.postCompactionAvgMs) : '—'}
          </p>
          {hasCompaction ? (
            <p
              className={`mt-0.5 font-medium ${isSignificant ? 'text-amber-500' : 'text-muted-foreground'}`}
            >
              {ratio.toFixed(1)}× normal {isSignificant ? '⚠' : '✓'}
            </p>
          ) : (
            <p className="mt-0.5 text-muted-foreground">no compaction data</p>
          )}
          {/* Bar */}
          <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full ${isSignificant ? 'bg-amber-500' : 'bg-violet-500'}`}
              style={{
                width: hasCompaction
                  ? `${Math.min(100, (data.postCompactionAvgMs / maxMs) * 100)}%`
                  : '0%',
              }}
            />
          </div>
        </div>
      </div>

      {/* Delta pill */}
      {hasCompaction && (
        <div
          className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs ${isSignificant ? 'bg-amber-500/10 text-amber-600' : 'bg-green-500/10 text-green-600'}`}
        >
          <Timer className="h-3 w-3" />
          <span>
            Post-compaction turns are{' '}
            <strong>{fmtMs(data.postCompactionAvgMs - data.normalAvgMs)}</strong>{' '}
            {isSignificant ? 'slower' : 'slower'} than normal
            {isSignificant
              ? ' — consider smaller prompts to reduce compaction frequency'
              : ' — within acceptable range'}
          </span>
        </div>
      )}
    </div>
  )
}

// ─── Slowest turns table ──────────────────────────────────────────────────────

function SlowestTurnsTable({ turns }: { turns: SlowTurnEntry[] }): React.JSX.Element {
  if (turns.length === 0) {
    return <p className="py-4 text-center text-xs text-muted-foreground">No slow turns recorded</p>
  }

  const maxMs = Math.max(...turns.map((t) => t.durationMs), 1)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="pb-1.5 text-left font-medium">Session</th>
            <th className="pb-1.5 text-right font-medium">Turn</th>
            <th className="pb-1.5 text-right font-medium pr-4">Duration</th>
            <th className="pb-1.5 text-right font-medium">Model</th>
            <th className="pb-1.5 text-right font-medium">Flag</th>
          </tr>
        </thead>
        <tbody>
          {turns.slice(0, 20).map((t) => {
            const pct = (t.durationMs / maxMs) * 100
            const isLong = t.durationMs >= 30_000
            const isMed = t.durationMs >= 5_000
            const barColor = isLong ? 'bg-red-500' : isMed ? 'bg-amber-500' : 'bg-indigo-500'
            return (
              <tr key={t.id} className="border-b last:border-0 hover:bg-muted/40">
                <td className="max-w-[160px] truncate py-2 pr-3 font-medium" title={t.sessionTitle}>
                  {t.sessionTitle}
                </td>
                <td className="py-2 text-right text-muted-foreground">#{t.turnIndex}</td>
                <td className="py-2 pr-4">
                  <div className="flex items-center justify-end gap-2">
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${barColor}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span
                      className={`w-12 text-right font-semibold tabular-nums ${isLong ? 'text-red-500' : isMed ? 'text-amber-500' : ''}`}
                    >
                      {fmtMs(t.durationMs)}
                    </span>
                  </div>
                </td>
                <td className="py-2 text-right">
                  {t.model ? (
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${getModelMeta(t.model).badgeClass}`}
                    >
                      {getModelMeta(t.model).label}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="py-2 text-right">
                  {t.isPostCompaction && (
                    <span className="rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-600">
                      post-compact
                    </span>
                  )}
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

export function LatencyTab({ data }: Props): React.JSX.Element {
  const { selectedProjectIds } = useAnalyticsStore()

  const filteredTurns = React.useMemo(() => {
    if (selectedProjectIds.length === 0) return data.slowestTurns
    return data.slowestTurns.filter((t) => selectedProjectIds.includes(t.projectId))
  }, [data.slowestTurns, selectedProjectIds])

  const compactionImpact =
    data.normalAvgMs > 0 && data.postCompactionAvgMs > 0
      ? ((data.postCompactionAvgMs - data.normalAvgMs) / data.normalAvgMs) * 100
      : 0

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Median (p50)"
          value={fmtMs(data.medianDurationMs)}
          subtitle="typical turn time"
          icon={<Clock className="h-4 w-4" />}
        />
        <StatCard
          label="p95 Latency"
          value={fmtMs(data.p95DurationMs)}
          subtitle="95th percentile"
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <StatCard
          label="p99 Latency"
          value={fmtMs(data.p99DurationMs)}
          subtitle="worst 1% of turns"
          icon={<AlertTriangle className="h-4 w-4" />}
        />
        <StatCard
          label="Compaction Impact"
          value={compactionImpact > 0 ? `+${compactionImpact.toFixed(0)}%` : '—'}
          subtitle={
            compactionImpact > 0
              ? `${fmtMs(data.postCompactionAvgMs)} vs ${fmtMs(data.normalAvgMs)}`
              : 'no compaction data'
          }
          deltaPositive={compactionImpact <= 0}
          icon={<Zap className="h-4 w-4" />}
        />
      </div>

      {/* Percentile comparison — horizontal bars */}
      <ChartCard
        title="Latency Percentiles"
        description="p50 · p95 · p99 · normal avg · post-compaction avg compared side by side"
      >
        <PercentilesChart data={data} />
      </ChartCard>

      {/* Turn distribution histogram */}
      <ChartCard
        title="Turn Duration Distribution"
        description="How long individual turns take — colour-coded by severity"
      >
        <LatencyHistogram data={data} />
      </ChartCard>

      {/* Normal vs post-compaction */}
      <ChartCard
        title="Compaction Effect on Latency"
        description="Average turn duration before vs immediately after a context compaction"
      >
        <CompactionComparison data={data} />
      </ChartCard>

      {/* Slowest turns */}
      <ChartCard
        title="Slowest Turns"
        description={
          selectedProjectIds.length > 0
            ? `Top 20 slowest turns in selected project — bar length proportional to duration`
            : `Top 20 slowest turns across all projects — bar length proportional to duration`
        }
      >
        <SlowestTurnsTable turns={filteredTurns} />
      </ChartCard>
    </div>
  )
}
