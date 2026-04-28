import React from 'react'
import { cn } from '@renderer/lib/cn'

interface EmptyStateProps {
  icon: React.ElementType
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center h-full gap-3 text-center px-8',
        className
      )}
    >
      <Icon className="h-8 w-8 text-muted-foreground/30" />
      <p className="text-sm text-muted-foreground">{title}</p>
      {description && <p className="text-xs text-muted-foreground/60">{description}</p>}
      {action}
    </div>
  )
}
