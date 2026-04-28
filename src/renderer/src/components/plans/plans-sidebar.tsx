import React, { useState } from 'react'
import { FileText, Clock, RefreshCw, Search, X, BookOpen } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { Skeleton } from '@renderer/components/ui/skeleton'
import type { PlanSummary } from '@shared/types'

interface Props {
  plans: PlanSummary[]
  selectedId: string | null
  onSelect: (id: string) => void
  isLoading: boolean
  onRefresh: () => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

function relativeDate(iso?: string): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function PlansSidebar({
  plans,
  selectedId,
  onSelect,
  isLoading,
  onRefresh,
}: Props): React.JSX.Element {
  const [search, setSearch] = useState('')
  const q = search.toLowerCase()

  const filtered = plans.filter(
    (p) => p.title.toLowerCase().includes(q) || p.filename.toLowerCase().includes(q)
  )

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Plans
          </span>
          {plans.length > 0 && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
              {plans.length}
            </span>
          )}
        </div>
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="p-1 rounded hover:bg-accent transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw
            className={cn('h-3.5 w-3.5 text-muted-foreground', isLoading && 'animate-spin')}
          />
        </button>
      </div>

      {/* Search */}
      <div className="px-2 py-1.5 border-b border-border/30">
        <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
          <Search className="h-3 w-3 text-muted-foreground shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter plans…"
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

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {isLoading && plans.length === 0 && (
          <div className="flex flex-col gap-2 p-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        )}

        {!isLoading && plans.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center px-3">
            <BookOpen className="h-6 w-6 text-muted-foreground/30 mb-2" />
            <p className="text-xs text-muted-foreground">No plans found</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1 font-mono">~/.claude/plans/</p>
          </div>
        )}

        {filtered.map((plan) => (
          <button
            key={plan.id}
            onClick={() => onSelect(plan.id)}
            className={cn(
              'w-full rounded-md px-2.5 py-2 text-left transition-colors',
              selectedId === plan.id ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-accent'
            )}
          >
            <div className="flex items-start gap-2 min-w-0">
              <FileText
                className={cn(
                  'h-3.5 w-3.5 mt-0.5 shrink-0',
                  selectedId === plan.id ? 'text-primary' : 'text-muted-foreground'
                )}
              />
              <div className="flex-1 min-w-0">
                <p
                  className={cn(
                    'text-xs font-medium truncate',
                    selectedId === plan.id ? 'text-primary' : 'text-foreground'
                  )}
                >
                  {plan.title}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Clock className="h-2.5 w-2.5 text-muted-foreground/60 shrink-0" />
                  <span className="text-[10px] text-muted-foreground/80">
                    {relativeDate(plan.createdAt)}
                  </span>
                  <span className="text-[10px] text-muted-foreground/50">
                    {formatBytes(plan.sizeBytes)}
                  </span>
                </div>
              </div>
            </div>
          </button>
        ))}

        {!isLoading && plans.length > 0 && filtered.length === 0 && (
          <div className="py-8 text-center">
            <p className="text-xs text-muted-foreground">No plans match &quot;{search}&quot;</p>
          </div>
        )}
      </div>
    </div>
  )
}
