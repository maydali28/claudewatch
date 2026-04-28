import React from 'react'
import { cn } from '@renderer/lib/cn'

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'secondary' | 'outline' | 'destructive' | 'success' | 'warning'
}

const variantClasses: Record<NonNullable<BadgeProps['variant']>, string> = {
  default: 'bg-primary/10 text-primary border-transparent',
  secondary: 'bg-secondary text-secondary-foreground border-transparent',
  outline: 'border-border text-foreground bg-transparent',
  destructive: 'bg-destructive/10 text-destructive border-transparent',
  success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-transparent',
  warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-transparent',
}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = 'default', ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5',
        'text-xs font-medium leading-none',
        variantClasses[variant],
        className
      )}
      {...props}
    />
  )
)
Badge.displayName = 'Badge'

export { Badge }
