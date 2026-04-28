import React from 'react'
import { TrendingUp, TrendingDown, Minus, MessageSquare, Layers, FolderGit2 } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { formatTokens } from '@shared/utils/format-tokens'
import { Sparkline } from './sparkline'

interface TodayStatsProps {
  sessionCount: number
  tokenCount: number
  messageCount: number
  projectCount: number
  weeklyUsage: Array<{ date: string; cost: number; tokens: number }>
}

function Delta({ current, previous }: { current: number; previous: number }): React.JSX.Element {
  if (previous === 0 && current === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
        <Minus className="h-2.5 w-2.5" />
        flat
      </span>
    )
  }

  const pct = previous === 0 ? 100 : ((current - previous) / previous) * 100
  const isUp = pct >= 0
  const Icon = isUp ? TrendingUp : TrendingDown
  const color = isUp
    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
    : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
        color
      )}
    >
      <Icon className="h-2.5 w-2.5" />
      {Math.abs(pct).toFixed(0)}%
    </span>
  )
}

function InlineStat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <Icon className="h-3 w-3 text-muted-foreground/80 shrink-0" />
      <span className="text-[11px] font-semibold tabular-nums text-foreground">{value}</span>
      <span className="text-[10px] text-muted-foreground truncate">{label}</span>
    </div>
  )
}

export function TodayStats({
  sessionCount,
  tokenCount,
  messageCount,
  projectCount,
  weeklyUsage,
}: TodayStatsProps): React.JSX.Element {
  const todayPoint = weeklyUsage[weeklyUsage.length - 1]
  const yesterdayPoint = weeklyUsage[weeklyUsage.length - 2]
  const todayTokens = todayPoint?.tokens ?? tokenCount
  const yesterdayTokens = yesterdayPoint?.tokens ?? 0

  return (
    <div className="flex flex-col gap-2 px-1 pt-1">
      {/* Hero row */}
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col min-w-0">
          <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-[0.14em]">
            Today
          </span>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span className="text-[26px] font-bold tabular-nums tracking-tight leading-none text-foreground">
              {formatTokens(tokenCount)}
            </span>
            <span className="text-[10px] font-medium text-muted-foreground">tokens</span>
          </div>
        </div>
        <Delta current={todayTokens} previous={yesterdayTokens} />
      </div>

      {/* Sparkline */}
      {weeklyUsage.length > 0 && (
        <div className="-mx-1">
          <Sparkline data={weeklyUsage} />
        </div>
      )}

      {/* Inline stats — sits flat on the popover */}
      <div className="flex items-center justify-center gap-3 text-[11px] pb-2">
        <InlineStat icon={Layers} label="sessions" value={String(sessionCount)} />
        <span className="h-3 w-px bg-border/60" aria-hidden />
        <InlineStat icon={MessageSquare} label="msgs" value={String(messageCount)} />
        <span className="h-3 w-px bg-border/60" aria-hidden />
        <InlineStat icon={FolderGit2} label="projects" value={String(projectCount)} />
      </div>
    </div>
  )
}
