import React from 'react'
import { Info } from 'lucide-react'
import { cn } from '@renderer/lib/cn'

interface StatCardProps {
  label: string
  value: string
  subtitle?: string
  badge?: string
  /**
   * Provenance about this figure — where it came from, not that anything is
   * wrong with it. Rendered as a small hover affordance beside the value
   * rather than as a second badge, because a provenance condition can be
   * common (one of them holds for ~26% of all real responses) and anything
   * permanently occupying this card stops being read.
   *
   * `badge` is the slot for a condition that genuinely needs attention; this
   * is the slot for a fact worth being able to look up. Keep them separate.
   */
  info?: string
  delta?: string
  deltaPositive?: boolean
  icon?: React.ReactNode
  className?: string
}

export function StatCard({
  label,
  value,
  subtitle,
  badge,
  info,
  delta,
  deltaPositive,
  icon,
  className,
}: StatCardProps): React.JSX.Element {
  return (
    <div className={cn('rounded-lg border bg-card p-4', className)}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {icon && <span className="text-muted-foreground/60">{icon}</span>}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <p className="text-2xl font-bold tracking-tight">{value}</p>
        {badge && (
          // `min-w-0` + `truncate` + `title`: these cards sit in a
          // `lg:grid-cols-5` row, so a long badge used to push its own card's
          // layout out with no max width and no way to read the rest of it.
          // Truncated with the full text on hover instead, so badge length can
          // never again decide how a KPI row looks.
          <span
            className="min-w-0 truncate rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground"
            title={badge}
          >
            {badge}
          </span>
        )}
        {info && (
          // Deliberately an icon, not text: provenance must stay reachable
          // without spending card width on a sentence that is present for
          // almost every user almost always. `title` carries the full wording
          // — the same sentences the session panel and the exports use — and
          // `aria-label` gives it to assistive tech, which a bare `title`
          // alone does not reliably do.
          <span
            className="shrink-0 text-muted-foreground/60"
            title={info}
            aria-label={info}
            role="note"
          >
            <Info className="h-3 w-3" />
          </span>
        )}
      </div>
      {(subtitle || delta) && (
        <div className="mt-1 flex items-center gap-2">
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          {delta && (
            <span
              className={cn(
                'text-xs font-medium',
                deltaPositive ? 'text-green-600' : 'text-red-500'
              )}
            >
              {delta}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
