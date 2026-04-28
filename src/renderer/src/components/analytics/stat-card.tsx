import React from 'react'
import { cn } from '@renderer/lib/cn'

interface StatCardProps {
  label: string
  value: string
  subtitle?: string
  badge?: string
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
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
            {badge}
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
