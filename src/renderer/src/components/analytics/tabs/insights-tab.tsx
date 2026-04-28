import React from 'react'
import {
  Lightbulb,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Info,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
} from 'lucide-react'
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts'
import { formatCost, formatTokens } from '@shared/utils'
import { ChartCard } from '@renderer/components/analytics/chart-card'
import { ProjectCostChart } from '@renderer/components/analytics/charts/project-cost-chart'
import { WhatIfCalculator } from '@renderer/components/analytics/charts/whatif-calculator'
import type {
  AnalyticsData,
  SessionHealthEntry,
  SessionHealthSummary,
  LintCheckId,
} from '@shared/types'

// ─── Insight severity ──────────────────────────────────────────────────────────

type InsightLevel = 'positive' | 'warning' | 'info'

interface Insight {
  id: string
  level: InsightLevel
  title: string
  body: string
}

function deriveInsights(data: AnalyticsData): Insight[] {
  const insights: Insight[] = []

  const cacheHitPct = Math.round(data.cacheAnalytics.hitRatio * 100)
  const avgCostPerSession = data.totalSessions > 0 ? data.totalCost / data.totalSessions : 0
  const topProject = [...data.projectCosts].sort((a, b) => b.totalCost - a.totalCost)[0]
  const topProjectSharePct =
    data.totalCost > 0 && topProject ? Math.round((topProject.totalCost / data.totalCost) * 100) : 0

  // Cache hit quality
  if (cacheHitPct >= 60) {
    insights.push({
      id: 'cache-good',
      level: 'positive',
      title: `Strong cache utilisation at ${cacheHitPct}%`,
      body: `You're saving ${formatCost(data.cacheAnalytics.costSavings)} vs uncached. Keep prompts stable to maintain this.`,
    })
  } else if (cacheHitPct < 30 && data.totalTokens > 0) {
    insights.push({
      id: 'cache-low',
      level: 'warning',
      title: `Cache hit rate is only ${cacheHitPct}%`,
      body: `Inconsistent prompt structures reduce cache reuse. Consider anchoring shared context at the top of your prompts.`,
    })
  }

  // Cost concentration
  if (topProjectSharePct >= 60 && topProject) {
    insights.push({
      id: 'cost-concentration',
      level: 'warning',
      title: `${topProject.projectName} accounts for ${topProjectSharePct}% of spend`,
      body: `Heavy cost concentration in one project. Review whether that workload could be handled by a cheaper model.`,
    })
  }

  // Latency anomalies
  if (data.latencyAnalytics.p95DurationMs > 30_000) {
    insights.push({
      id: 'latency-high',
      level: 'warning',
      title: `p95 latency is above 30s (${(data.latencyAnalytics.p95DurationMs / 1000).toFixed(1)}s)`,
      body: `High tail latency suggests some turns are generating very long outputs or hitting rate limits.`,
    })
  }

  // Effort skew
  const { distribution } = data.effortAnalytics
  const total = Object.values(distribution).reduce((s, v) => s + v, 0)
  const ultrathinkPct = total > 0 ? Math.round(((distribution.ultrathink ?? 0) / total) * 100) : 0
  if (ultrathinkPct >= 25) {
    insights.push({
      id: 'ultrathink-high',
      level: 'info',
      title: `${ultrathinkPct}% of turns are ultrathink`,
      body: `Extended thinking is expensive. Ensure you're reserving it for tasks that genuinely need deep reasoning.`,
    })
  }

  // Low session count sanity
  if (data.totalSessions === 0) {
    insights.push({
      id: 'no-sessions',
      level: 'info',
      title: 'No sessions in this period',
      body: `Try expanding the date range or checking that sessions are being parsed correctly.`,
    })
  }

  // Avg cost per session
  if (avgCostPerSession > 1.0) {
    insights.push({
      id: 'high-session-cost',
      level: 'warning',
      title: `Average session cost is ${formatCost(avgCostPerSession)}`,
      body: `High per-session cost could indicate long context windows or heavy subagent usage. Review the most expensive sessions.`,
    })
  }

  // Positive: savings available through model switch
  const mostExpensiveModel = [...data.modelEfficiency].sort((a, b) => b.totalCost - a.totalCost)[0]
  if (mostExpensiveModel && mostExpensiveModel.percentOfTotalCost > 70) {
    insights.push({
      id: 'model-dominance',
      level: 'info',
      title: `${mostExpensiveModel.model} drives ${mostExpensiveModel.percentOfTotalCost.toFixed(0)}% of cost`,
      body: `Use the What-If Calculator below to estimate savings by routing some of this workload to a lighter model.`,
    })
  }

  // ── Compaction insights ───────────────────────────────────────────────────────

  const { compactionAnalytics } = data.cacheAnalytics
  const { postCompactionAvgMs, normalAvgMs } = data.latencyAnalytics

  // Frequent compactions — context windows filling up regularly
  const avgCompactionsPerSession =
    data.totalSessions > 0 ? compactionAnalytics.totalCompactions / data.totalSessions : 0
  if (avgCompactionsPerSession >= 1) {
    insights.push({
      id: 'compaction-frequent',
      level: 'warning',
      title: `Sessions compact ${avgCompactionsPerSession.toFixed(1)}× on average`,
      body: `Context windows are filling up regularly. ${formatTokens(compactionAnalytics.avgTokensRemovedPerSession)} tokens removed per affected session. Consider breaking long workflows into smaller, focused sessions to reduce compaction overhead.`,
    })
  } else if (compactionAnalytics.totalCompactions > 0) {
    insights.push({
      id: 'compaction-present',
      level: 'info',
      title: `${compactionAnalytics.totalCompactions} compaction${compactionAnalytics.totalCompactions > 1 ? 's' : ''} across ${data.totalSessions} sessions`,
      body: `Some sessions hit the context limit and were summarised automatically. ${formatTokens(compactionAnalytics.totalTokensRemoved)} tokens removed in total — estimated ${formatCost(compactionAnalytics.estimatedCostAvoided)} avoided by not re-sending them as fresh input.`,
    })
  }

  // Post-compaction latency spike
  if (postCompactionAvgMs > 0 && normalAvgMs > 0) {
    const ratio = postCompactionAvgMs / normalAvgMs
    if (ratio >= 1.5) {
      insights.push({
        id: 'compaction-latency-spike',
        level: 'warning',
        title: `Post-compaction turns are ${ratio.toFixed(1)}× slower`,
        body: `Turns immediately after a compaction average ${(postCompactionAvgMs / 1000).toFixed(1)}s vs ${(normalAvgMs / 1000).toFixed(1)}s normally. This is expected — Claude regenerates the context summary — but very large spikes may indicate oversized system prompts.`,
      })
    } else if (ratio >= 1.2) {
      insights.push({
        id: 'compaction-latency-mild',
        level: 'info',
        title: `Mild latency increase after compactions (${ratio.toFixed(1)}×)`,
        body: `Post-compaction turns take ${(postCompactionAvgMs / 1000).toFixed(1)}s on average vs ${(normalAvgMs / 1000).toFixed(1)}s normally. This is within a healthy range.`,
      })
    }
  }

  // High value recovered — surface as a positive
  if (compactionAnalytics.estimatedCostAvoided > 0.5) {
    insights.push({
      id: 'compaction-savings',
      level: 'positive',
      title: `Compaction saved an estimated ${formatCost(compactionAnalytics.estimatedCostAvoided)}`,
      body: `${formatTokens(compactionAnalytics.totalTokensRemoved)} tokens were compacted rather than re-sent. These tokens were summarised and never charged as fresh input in subsequent turns.`,
    })
  }

  return insights
}

const LEVEL_CONFIG: Record<
  InsightLevel,
  { icon: React.ElementType; classes: string; iconClass: string }
> = {
  positive: {
    icon: CheckCircle2,
    classes: 'border-green-500/30 bg-green-500/5',
    iconClass: 'text-green-500',
  },
  warning: {
    icon: AlertTriangle,
    classes: 'border-amber-500/30 bg-amber-500/5',
    iconClass: 'text-amber-500',
  },
  info: { icon: Info, classes: 'border-blue-500/30 bg-blue-500/5', iconClass: 'text-blue-500' },
}

function InsightCard({ insight }: { insight: Insight }): React.JSX.Element {
  const { icon: Icon, classes, iconClass } = LEVEL_CONFIG[insight.level]
  return (
    <div className={`flex gap-3 rounded-lg border p-3 ${classes}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconClass}`} />
      <div className="min-w-0">
        <p className="text-xs font-semibold">{insight.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{insight.body}</p>
      </div>
    </div>
  )
}

// ─── Project breakdown table ───────────────────────────────────────────────────

function ProjectBreakdownTable({ data }: Pick<Props, 'data'>): React.JSX.Element {
  const sorted = [...data.projectCosts].sort((a, b) => b.totalCost - a.totalCost)
  const total = data.totalCost

  if (sorted.length === 0) {
    return <p className="py-4 text-center text-xs text-muted-foreground">No project data</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="pb-1.5 text-left font-medium">Project</th>
            <th className="pb-1.5 text-right font-medium">Sessions</th>
            <th className="pb-1.5 text-right font-medium">Tokens</th>
            <th className="pb-1.5 text-right font-medium">Cost</th>
            <th className="pb-1.5 text-right font-medium">Share</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => {
            const share = total > 0 ? (p.totalCost / total) * 100 : 0
            return (
              <tr key={p.id} className="border-b last:border-0 hover:bg-muted/40">
                <td
                  className="py-1.5 pr-3 font-medium max-w-[160px] truncate"
                  title={p.projectName}
                >
                  {p.projectName}
                </td>
                <td className="py-1.5 text-right text-muted-foreground">{p.sessionCount}</td>
                <td className="py-1.5 text-right text-muted-foreground">
                  {formatTokens(p.totalTokens)}
                </td>
                <td className="py-1.5 text-right font-semibold">{formatCost(p.totalCost)}</td>
                <td className="py-1.5 pl-3 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.min(share, 100)}%` }}
                      />
                    </div>
                    <span className="w-8 text-right text-muted-foreground">
                      {share.toFixed(0)}%
                    </span>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Session Health ───────────────────────────────────────────────────────────

const FLAG_META: Record<LintCheckId, string> = {
  SES001: 'Cost >$25',
  SES002: '5+ compactions',
  SES003: '>2M tokens',
  SES004: 'Stale session',
  SES005: 'Has errors',
  SES006: 'Idle/zombie gap',
} as Partial<Record<LintCheckId, string>> as Record<LintCheckId, string>

const SEVERITY_CONFIG = {
  error: {
    label: 'Error',
    color: 'text-destructive',
    bg: 'bg-destructive/10',
    badgeBg: 'bg-destructive/20 text-destructive',
  },
  warning: {
    label: 'Warning',
    color: 'text-amber-500',
    bg: 'bg-amber-500/10',
    badgeBg: 'bg-amber-500/20 text-amber-600',
  },
  info: {
    label: 'Info',
    color: 'text-blue-500',
    bg: 'bg-blue-500/10',
    badgeBg: 'bg-blue-500/20 text-blue-600',
  },
}

const PIE_COLORS = {
  clean: 'hsl(var(--chart-2, 142 76% 36%))',
  warning: 'hsl(var(--chart-4, 38 92% 50%))',
  error: 'hsl(var(--chart-1, 0 72% 51%))',
}

function HealthDonutChart({ summary }: { summary: SessionHealthSummary }): React.JSX.Element {
  const total = summary.cleanCount + summary.warningCount + summary.errorCount
  if (total === 0) {
    return (
      <p className="py-6 text-center text-xs text-muted-foreground">No sessions in this period</p>
    )
  }

  const pieData = [
    { name: 'Clean', value: summary.cleanCount, color: PIE_COLORS.clean },
    { name: 'Warning', value: summary.warningCount, color: PIE_COLORS.warning },
    { name: 'Error', value: summary.errorCount, color: PIE_COLORS.error },
  ].filter((d) => d.value > 0)

  return (
    <div className="flex flex-col gap-3">
      <ResponsiveContainer width="100%" height={160}>
        <PieChart>
          <Pie
            data={pieData}
            cx="50%"
            cy="50%"
            innerRadius={42}
            outerRadius={68}
            paddingAngle={2}
            dataKey="value"
          >
            {pieData.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: number, name: string) => [
              `${value} (${((value / total) * 100).toFixed(0)}%)`,
              name,
            ]}
            contentStyle={{ fontSize: 11, borderRadius: 6 }}
          />
          <Legend iconSize={8} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-2">
          <ShieldCheck className="mx-auto mb-0.5 h-3.5 w-3.5 text-green-500" />
          <p className="text-sm font-semibold text-green-600">{summary.cleanCount}</p>
          <p className="text-[10px] text-muted-foreground">Clean</p>
        </div>
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2">
          <ShieldAlert className="mx-auto mb-0.5 h-3.5 w-3.5 text-amber-500" />
          <p className="text-sm font-semibold text-amber-600">{summary.warningCount}</p>
          <p className="text-[10px] text-muted-foreground">Warning</p>
        </div>
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-2">
          <ShieldX className="mx-auto mb-0.5 h-3.5 w-3.5 text-destructive" />
          <p className="text-sm font-semibold text-destructive">{summary.errorCount}</p>
          <p className="text-[10px] text-muted-foreground">Error</p>
        </div>
      </div>
    </div>
  )
}

function UnhealthySessionsTable({ entries }: { entries: SessionHealthEntry[] }): React.JSX.Element {
  if (entries.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/5 p-3">
        <ShieldCheck className="h-4 w-4 text-green-500 shrink-0" />
        <p className="text-xs text-green-700 dark:text-green-400">
          All sessions are healthy in this period.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="pb-1.5 text-left font-medium">Session</th>
            <th className="pb-1.5 text-left font-medium">Flags</th>
            <th className="pb-1.5 text-right font-medium">Cost</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const cfg = SEVERITY_CONFIG[entry.worstSeverity]
            return (
              <tr key={entry.sessionId} className="border-b last:border-0 hover:bg-muted/30">
                <td className="py-1.5 pr-3 max-w-[160px]">
                  <p className="truncate font-medium" title={entry.sessionTitle}>
                    {entry.sessionTitle}
                  </p>
                </td>
                <td className="py-1.5 pr-3">
                  <div className="flex flex-wrap gap-1">
                    {entry.flags.map((flag) => (
                      <span
                        key={flag}
                        title={FLAG_META[flag] ?? flag}
                        className={`rounded px-1 py-0.5 text-[9px] font-semibold ${cfg.badgeBg}`}
                      >
                        {flag}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="py-1.5 text-right font-semibold">
                  {formatCost(entry.estimatedCost)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function HealthTrendChart({
  trend,
}: {
  trend: SessionHealthSummary['dailyHealthTrend']
}): React.JSX.Element {
  if (trend.length < 2) {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground">Not enough data for a trend</p>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={150}>
      <LineChart data={trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 9 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: string) => v.slice(5)}
        />
        <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} width={24} />
        <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6 }} />
        <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
        <Line
          type="monotone"
          dataKey="clean"
          stroke={PIE_COLORS.clean}
          strokeWidth={1.5}
          dot={false}
          name="Clean"
        />
        <Line
          type="monotone"
          dataKey="flagged"
          stroke={PIE_COLORS.warning}
          strokeWidth={1.5}
          dot={false}
          name="Flagged"
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

function SessionHealthCard({ summary }: { summary: SessionHealthSummary }): React.JSX.Element {
  return (
    <ChartCard
      title="Session Health"
      description="Sessions evaluated against SES001–SES006 lint rules"
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <HealthDonutChart summary={summary} />
        <div className="flex flex-col gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Health trend
          </p>
          <HealthTrendChart trend={summary.dailyHealthTrend} />
        </div>
      </div>

      <div className="mt-4 border-t border-border/50 pt-4">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Top unhealthy sessions
        </p>
        <UnhealthySessionsTable entries={summary.topUnhealthy} />
      </div>
    </ChartCard>
  )
}

// ─── Tab root ─────────────────────────────────────────────────────────────────

interface Props {
  data: AnalyticsData
}

export function InsightsTab({ data }: Props): React.JSX.Element {
  const insights = React.useMemo(() => deriveInsights(data), [data])

  return (
    <div className="space-y-4">
      {/* Auto-generated insights */}
      <ChartCard
        title="Automated Insights"
        description="Observations derived from your usage patterns"
        action={<Lightbulb className="h-4 w-4 text-amber-400" />}
      >
        {insights.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted-foreground">
            No significant patterns detected for this period.
          </p>
        ) : (
          <div className="space-y-2">
            {insights.map((ins) => (
              <InsightCard key={ins.id} insight={ins} />
            ))}
          </div>
        )}
      </ChartCard>

      {/* Project breakdown */}
      <ChartCard
        title="Project Breakdown"
        description="Cost, token, and session breakdown per project"
        action={<ArrowRight className="h-4 w-4 text-muted-foreground" />}
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ProjectBreakdownTable data={data} />
          <ProjectCostChart data={data.projectCosts} />
        </div>
      </ChartCard>

      {/* Session health */}
      <SessionHealthCard summary={data.sessionHealthSummary} />

      {/* What-if model calculator */}
      <ChartCard
        title="What-If Calculator"
        description="Estimate cost impact of switching to a different model"
      >
        <WhatIfCalculator data={data.modelEfficiency} />
      </ChartCard>
    </div>
  )
}
