import React from 'react'
import { cn } from '@renderer/lib/cn'

interface ChartCardProps {
  title: string
  description?: string
  children: React.ReactNode
  className?: string
  action?: React.ReactNode
}

export function ChartCard({
  title,
  description,
  children,
  className,
  action,
}: ChartCardProps): React.JSX.Element {
  return (
    <div className={cn('rounded-lg border bg-card p-4', className)}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </div>
  )
}
