import React, { useEffect } from 'react'
import { LayoutDashboard, MoreHorizontal, Download, Info, Power, Activity } from 'lucide-react'
import appIcon from '@renderer/assets/claudewatch-ring.svg'
import { Skeleton } from '@renderer/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@renderer/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu'
import { ipc } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/cn'
import { TodayStats } from './today-stats'
import { ActiveSessions } from './active-sessions'
import { RecentSessions } from './recent-sessions'
import { useTrayData } from './use-tray-data'

function LoadingSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 p-4">
      <Skeleton className="h-32 rounded-xl" />
      <Skeleton className="h-4 w-16 rounded" />
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-12 rounded-md" />
        <Skeleton className="h-10 rounded-md" />
        <Skeleton className="h-10 rounded-md" />
      </div>
    </div>
  )
}

const headerIconClass = cn(
  'flex h-7 w-7 items-center justify-center rounded-md relative',
  'text-muted-foreground hover:bg-accent hover:text-foreground transition-colors'
)

function Header({
  liveCount,
  hasUpdate,
}: {
  liveCount: number
  hasUpdate: boolean
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'relative px-3 pt-3 pb-2.5 border-b border-border/60',
        'bg-gradient-to-b from-muted/30 to-transparent'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        {/* Brand */}
        <div className="flex items-center gap-2 min-w-0">
          <img
            src={appIcon}
            alt=""
            aria-hidden
            className="h-5 w-5 rounded-md drop-shadow-sm shrink-0"
          />
          <span className="text-[12px] font-bold tracking-tight text-foreground truncate">
            ClaudeWatch
          </span>
        </div>

        {/* Right cluster: live pill + dashboard + more */}
        <div className="flex items-center gap-1 shrink-0">
          {liveCount > 0 && (
            <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 mr-1">
              <span className="relative flex items-center justify-center w-1.5 h-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75 animate-ping" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                {liveCount} live
              </span>
            </div>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Open dashboard"
                onClick={() => ipc.tray.openDashboard()}
                className={headerIconClass}
              >
                <LayoutDashboard className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              Open dashboard
            </TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button type="button" aria-label="More actions" className={headerIconClass}>
                    <MoreHorizontal className="h-4 w-4" />
                    {hasUpdate && (
                      <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-primary border border-background" />
                    )}
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                More actions
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" sideOffset={6} className="min-w-[160px]">
              <DropdownMenuItem onClick={() => ipc.tray.showUpdate()} className="text-[12px] gap-2">
                <Download className="h-3.5 w-3.5" />
                <span className="flex-1">Updates</span>
                {hasUpdate && (
                  <span className="text-[9px] font-bold text-primary tracking-wider">NEW</span>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => ipc.tray.showAbout()} className="text-[12px] gap-2">
                <Info className="h-3.5 w-3.5" />
                About
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => ipc.app.quit()}
                className="text-[12px] gap-2 text-destructive focus:text-destructive focus:bg-destructive/10"
              >
                <Power className="h-3.5 w-3.5" />
                Quit ClaudeWatch
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  )
}

function EmptyState(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted/40 mb-3">
        <Activity className="h-4 w-4 text-muted-foreground/60" />
      </div>
      <p className="text-[12px] font-medium text-foreground">No sessions today</p>
      <p className="text-[10px] text-muted-foreground mt-1">
        Activity will show up here as you work.
      </p>
    </div>
  )
}

export default function TrayPopover(): React.JSX.Element {
  const {
    todayStats,
    weeklyUsage,
    activeSessions,
    recentSessions,
    isLoading,
    error,
    updateInfo,
    launchAtLogin,
    trayTipDismissed,
  } = useTrayData()

  const hasActivity = activeSessions.length > 0 || recentSessions.length > 0

  // Use the max session token count across both lists so progress bars are
  // proportional to the heaviest session visible — matches the dashboard
  // sidebar's behaviour of normalising against the project's largest session.
  const listTotalTokens = Math.max(
    1,
    ...[...activeSessions, ...recentSessions].map((s) => s.totalInputTokens + s.totalOutputTokens)
  )

  // Open dedicated onboarding window once loading completes and tip hasn't been dismissed
  useEffect(() => {
    if (!isLoading && !trayTipDismissed) {
      ipc.tray.showOnboarding(launchAtLogin)
    }
  }, [isLoading, trayTipDismissed, launchAtLogin])

  return (
    <TooltipProvider delayDuration={300}>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        role="main"
        className={cn(
          'flex flex-col w-full h-screen',
          'bg-background/95 backdrop-blur-xl text-foreground',
          'border border-border/50 rounded-xl overflow-hidden',
          'shadow-xl shadow-black/10',
          'select-none'
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Header liveCount={activeSessions.length} hasUpdate={updateInfo !== null} />

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
          {isLoading ? (
            <LoadingSkeleton />
          ) : error ? (
            <div className="px-4 py-6 text-center">
              <p className="text-[11px] text-destructive">{error}</p>
            </div>
          ) : (
            <div className="flex flex-col p-3">
              <TodayStats
                sessionCount={todayStats.sessionCount}
                tokenCount={todayStats.tokenCount}
                messageCount={todayStats.messageCount}
                projectCount={todayStats.projectCount}
                weeklyUsage={weeklyUsage}
              />

              <div className="h-px bg-border/50 my-3" />

              {hasActivity ? (
                <div className="flex flex-col gap-2">
                  <ActiveSessions sessions={activeSessions} totalTokens={listTotalTokens} />
                  {activeSessions.length > 0 && recentSessions.length > 0 && (
                    <div className="h-px bg-border/40 my-0.5" />
                  )}
                  <RecentSessions sessions={recentSessions} totalTokens={listTotalTokens} />
                </div>
              ) : (
                <EmptyState />
              )}
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}
