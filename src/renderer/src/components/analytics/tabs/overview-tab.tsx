import React from 'react'
import {
  TrendingUp,
  Activity,
  Layers,
  DollarSign,
  MessageSquare,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react'
import { formatCost, formatTokens, resolveDateRange, isWithinRange } from '@shared/utils'
import { useAnalyticsStore } from '@renderer/store/analytics.store'
import { useSessionsStore } from '@renderer/store/sessions.store'
import { StatCard } from '@renderer/components/analytics/stat-card'
import { DailyUsageChart } from '@renderer/components/analytics/charts/daily-usage-chart'
import { ProjectCostChart } from '@renderer/components/analytics/charts/project-cost-chart'
import { DailyModelCostChart } from '@renderer/components/analytics/charts/daily-model-cost-chart'
import { ChartCard } from '@renderer/components/analytics/chart-card'
import type { AnalyticsData, SessionSummary } from '@shared/types'

// ─── Filtered session list ────────────────────────────────────────────────────

type SortKey = 'lastTimestamp' | 'messageCount' | 'estimatedCost' | 'totalTokens'
type SortDir = 'asc' | 'desc'

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

interface SortHeaderProps {
  label: string
  sortKey: SortKey
  active: SortKey
  dir: SortDir
  onSort(k: SortKey): void
}

function SortHeader({ label, sortKey, active, dir, onSort }: SortHeaderProps): React.JSX.Element {
  const isActive = active === sortKey
  const Icon = isActive ? (dir === 'desc' ? ArrowDown : ArrowUp) : ArrowUpDown
  return (
    <th
      className="cursor-pointer select-none pb-2 text-right font-medium text-muted-foreground hover:text-foreground"
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center justify-end gap-1">
        {label}
        <Icon className={`h-3 w-3 ${isActive ? 'text-primary' : 'opacity-40'}`} />
      </span>
    </th>
  )
}

function SessionsTable({ sessions }: { sessions: SessionSummary[] }): React.JSX.Element {
  const [sortKey, setSortKey] = React.useState<SortKey>('lastTimestamp')
  const [sortDir, setSortDir] = React.useState<SortDir>('desc')

  function handleSort(key: SortKey): void {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sorted = React.useMemo(() => {
    const sign = sortDir === 'asc' ? 1 : -1
    return [...sessions].sort((a, b) => {
      switch (sortKey) {
        case 'lastTimestamp':
          return sign * a.lastTimestamp.localeCompare(b.lastTimestamp)
        case 'messageCount':
          return sign * (a.messageCount - b.messageCount)
        case 'estimatedCost':
          return sign * (a.estimatedCost - b.estimatedCost)
        case 'totalTokens':
          return (
            sign *
            (a.totalInputTokens + a.totalOutputTokens - (b.totalInputTokens + b.totalOutputTokens))
          )
        default:
          return 0
      }
    })
  }, [sessions, sortKey, sortDir])

  if (sorted.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-muted-foreground">No sessions in this period</p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b">
            <th className="pb-2 text-left font-medium text-muted-foreground">Session</th>
            <SortHeader
              label="Last active"
              sortKey="lastTimestamp"
              active={sortKey}
              dir={sortDir}
              onSort={handleSort}
            />
            <SortHeader
              label="Messages"
              sortKey="messageCount"
              active={sortKey}
              dir={sortDir}
              onSort={handleSort}
            />
            <SortHeader
              label="Tokens"
              sortKey="totalTokens"
              active={sortKey}
              dir={sortDir}
              onSort={handleSort}
            />
            <SortHeader
              label="Cost"
              sortKey="estimatedCost"
              active={sortKey}
              dir={sortDir}
              onSort={handleSort}
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map((s) => {
            const totalTokens = s.totalInputTokens + s.totalOutputTokens
            return (
              <tr key={s.id} className="border-b last:border-0 hover:bg-muted/40">
                <td className="max-w-[220px] py-2 pr-4">
                  <p className="truncate font-medium leading-tight" title={s.title}>
                    {s.title}
                  </p>
                  {s.hasError && (
                    <span className="mt-0.5 inline-block rounded-sm bg-destructive/10 px-1 py-px text-[9px] font-semibold text-destructive">
                      error
                    </span>
                  )}
                </td>
                <td className="py-2 text-right text-muted-foreground">
                  {formatRelativeTime(s.lastTimestamp)}
                </td>
                <td className="py-2 text-right">{s.parentMessageCount.toLocaleString()}</td>
                <td className="py-2 text-right text-muted-foreground">
                  {formatTokens(totalTokens)}
                </td>
                <td className="py-2 text-right font-semibold">{formatCost(s.estimatedCost)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Hook: derive filtered sessions from store state ─────────────────────────

function useFilteredSessions(): { sessions: SessionSummary[]; label: string } {
  const { dateRange, selectedProjectIds } = useAnalyticsStore()
  const { projects } = useSessionsStore()

  return React.useMemo(() => {
    const { from, to } = resolveDateRange(dateRange)

    // Collect sessions from projects that match the active filter
    const allSessions: SessionSummary[] = []
    for (const project of projects) {
      if (selectedProjectIds.length > 0 && !selectedProjectIds.includes(project.id)) continue
      for (const session of project.sessions) {
        if (isWithinRange(session.lastTimestamp, from, to)) {
          allSessions.push(session)
        }
      }
    }

    const label =
      selectedProjectIds.length === 1
        ? (projects.find((p) => p.id === selectedProjectIds[0])?.name ?? 'Selected project')
        : selectedProjectIds.length > 1
          ? `${selectedProjectIds.length} projects`
          : 'All projects'

    return { sessions: allSessions, label }
  }, [dateRange, selectedProjectIds, projects])
}

// ─── Tab root ─────────────────────────────────────────────────────────────────

interface Props {
  data: AnalyticsData
}

export function OverviewTab({ data }: Props): React.JSX.Element {
  const avgCostPerSession = data.totalSessions > 0 ? data.totalCost / data.totalSessions : 0
  const avgTokensPerSession = data.totalSessions > 0 ? data.totalTokens / data.totalSessions : 0
  const avgMessagesPerSession =
    data.totalSessions > 0 ? Math.round(data.totalMessages / data.totalSessions) : 0
  const cacheHitPct = Math.round(data.cacheAnalytics.hitRatio * 100)
  const totalCacheTokens = data.totalCacheTokens

  const { sessions, label } = useFilteredSessions()

  return (
    <div className="space-y-4">
      {/* Primary KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard
          label="Sessions"
          value={data.totalSessions.toLocaleString()}
          subtitle={`${avgMessagesPerSession} avg msgs/session`}
          icon={<Activity className="h-4 w-4" />}
        />
        <StatCard
          label="Total Messages"
          value={data.totalMessages.toLocaleString()}
          subtitle={`${avgMessagesPerSession} avg/session`}
          icon={<MessageSquare className="h-4 w-4" />}
        />
        <StatCard
          label="Total Tokens"
          value={formatTokens(data.totalTokens)}
          badge={totalCacheTokens > 0 ? `+ ${formatTokens(totalCacheTokens)} cache` : undefined}
          subtitle={`${formatTokens(avgTokensPerSession)} avg/session`}
          icon={<Layers className="h-4 w-4" />}
        />
        <StatCard
          label="Cache Hit Rate"
          value={`${cacheHitPct}%`}
          subtitle={`${formatCost(data.cacheAnalytics.costSavings)} saved`}
          deltaPositive
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <StatCard
          label="Total Cost"
          value={formatCost(data.totalCost)}
          subtitle={`${formatCost(avgCostPerSession)} avg/session`}
          icon={<DollarSign className="h-4 w-4" />}
        />
      </div>

      {/* Daily token usage — full width */}
      <ChartCard title="Daily Token Usage">
        <DailyUsageChart data={data.dailyUsage} />
      </ChartCard>

      {/* Two-column: projects + daily model cost */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Project Costs">
          <ProjectCostChart data={data.projectCosts} />
        </ChartCard>
        <ChartCard title="Daily Cost by Model">
          <DailyModelCostChart data={data.dailyModelCost} />
        </ChartCard>
      </div>

      {/* Filtered sessions list */}
      <ChartCard
        title={`Sessions — ${label}`}
        description={`${sessions.length} session${sessions.length !== 1 ? 's' : ''} in this period`}
      >
        <SessionsTable sessions={sessions} />
      </ChartCard>
    </div>
  )
}
