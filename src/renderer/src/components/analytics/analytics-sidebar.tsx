import React from 'react'
import { BarChart2, RefreshCw, Search, X } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { useAnalyticsStore } from '@renderer/store/analytics.store'
import { useSessionsStore } from '@renderer/store/sessions.store'
import { formatCost, formatTokens } from '@shared/utils'

export default function AnalyticsSidebar(): React.JSX.Element {
  const { selectedProjectIds, isLoading, baselineData, setProjectFilter, refresh } =
    useAnalyticsStore()
  const { projects, loadProjects, isLoadingProjects } = useSessionsStore()
  const [search, setSearch] = React.useState('')

  // Load projects on first mount if they haven't been fetched yet.
  // This handles the case where the app starts directly on the analytics view,
  // bypassing SessionsSidebar which is the only other caller of loadProjects.
  React.useEffect(() => {
    if (projects.length === 0 && !isLoadingProjects) {
      loadProjects()
    }
  }, [projects.length, isLoadingProjects, loadProjects])

  const selectedProjectId = selectedProjectIds.length === 1 ? selectedProjectIds[0] : null

  // Use baselineData (all-projects, current date range) for stable totals
  const projectCostMap = React.useMemo(() => {
    if (!baselineData) return {}
    return Object.fromEntries(baselineData.projectCosts.map((p) => [p.projectId, p]))
  }, [baselineData])

  const totalTokens = baselineData?.totalTokens ?? 0
  const totalCost = baselineData?.totalCost ?? 0

  function handleProjectSelect(projectId: string | null): void {
    setProjectFilter(projectId ? [projectId] : [])
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header — matches sessions sidebar style */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Analytics
        </span>
        <button
          onClick={() => refresh(true)}
          disabled={isLoading}
          className="p-1 rounded hover:bg-accent transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw
            className={cn('h-3.5 w-3.5 text-muted-foreground', isLoading && 'animate-spin')}
          />
        </button>
      </div>

      {/* Search bar — matches sessions sidebar style */}
      <div className="px-2 py-1.5 border-b border-border/30">
        <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
          <Search className="h-3 w-3 text-muted-foreground shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects…"
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="p-0.5 hover:text-foreground text-muted-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1">
        {/* All projects — hidden while searching or while initial load */}
        {!search && !(isLoadingProjects && projects.length === 0) && (
          <button
            onClick={() => handleProjectSelect(null)}
            className={cn(
              'w-full rounded-md px-2.5 py-2 text-left transition-colors',
              selectedProjectId === null
                ? 'bg-primary/10 ring-1 ring-primary/30'
                : 'hover:bg-accent'
            )}
          >
            <div className="flex items-center justify-between mb-1">
              <span
                className={cn(
                  'text-xs font-medium',
                  selectedProjectId === null ? 'text-primary' : 'text-foreground'
                )}
              >
                All projects
              </span>
              <span className="text-[10px] text-muted-foreground">{formatCost(totalCost)}</span>
            </div>
            <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
              <div className="h-full w-full rounded-full bg-primary/40" />
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              {formatTokens(totalTokens)} tokens
            </div>
          </button>
        )}

        {/* No projects at all */}
        {!isLoadingProjects && projects.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center px-3">
            <BarChart2 className="h-6 w-6 text-muted-foreground/30 mb-2" />
            <p className="text-xs text-muted-foreground">No projects found</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1">
              Start a Claude session to see projects
            </p>
          </div>
        )}

        {/* Search no matches */}
        {search &&
          projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase())).length ===
            0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center px-3">
              <p className="text-xs text-muted-foreground">No matches for &quot;{search}&quot;</p>
            </div>
          )}

        {projects
          .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
          .map((project) => {
            const stats = projectCostMap[project.id]
            const pTokens = stats?.totalTokens ?? 0
            const pCost = stats?.totalCost ?? 0
            const pct = totalTokens > 0 ? Math.min(100, (pTokens / totalTokens) * 100) : 0
            const isSelected = selectedProjectId === project.id

            return (
              <button
                key={project.id}
                onClick={() => handleProjectSelect(project.id)}
                className={cn(
                  'w-full rounded-md px-2.5 py-2 text-left transition-colors',
                  isSelected ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-accent'
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <span
                    className={cn(
                      'truncate text-xs font-medium',
                      isSelected ? 'text-primary' : 'text-foreground'
                    )}
                    title={project.name}
                  >
                    {project.name}
                  </span>
                  <span className="ml-2 shrink-0 text-[10px] text-muted-foreground">
                    {formatCost(pCost)}
                  </span>
                </div>
                <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-500',
                      isSelected ? 'bg-primary' : 'bg-primary/40'
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  {formatTokens(pTokens)} · {pct.toFixed(0)}% of total
                </div>
              </button>
            )
          })}
      </div>
    </div>
  )
}
