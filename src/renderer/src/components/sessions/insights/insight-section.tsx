import React from 'react'
import { cn } from '@renderer/lib/cn'

export function InsightSection({
  title,
  note,
  children,
  className,
  action,
}: {
  title: string
  note?: string
  children: React.ReactNode
  className?: string
  /** A control at the top right, such as a view toggle. */
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <section className={cn('rounded-lg border border-border/60 bg-card p-4', className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
        </div>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}

export function StatTiles({
  tiles,
}: {
  tiles: Array<{ label: string; value: React.ReactNode; hint?: string }>
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-lg border border-border/60 bg-card px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t.label}
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{t.value}</p>
          {t.hint && <p className="mt-0.5 text-xs text-muted-foreground">{t.hint}</p>}
        </div>
      ))}
    </div>
  )
}

export const TH = 'py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground'

export function formatChars(chars: number): string {
  if (chars < 1000) return `${chars} ch`
  if (chars < 1_000_000) return `${(chars / 1000).toFixed(chars < 10_000 ? 1 : 0)}k ch`
  return `${(chars / 1_000_000).toFixed(1)}M ch`
}

export function percent(value: number): string {
  if (value === 0) return '0%'
  if (value < 0.001) return '<0.1%'
  return `${(value * 100).toFixed(1)}%`
}
