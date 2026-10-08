import React from 'react'
import { cn } from '@renderer/lib/cn'
import type { ContextFillLevel, ContextFillView } from './context-fill-rules'

const LEVEL_CLASS: Record<Exclude<ContextFillLevel, 'normal'>, string> = {
  warning: 'bg-amber-500',
  critical: 'bg-red-500',
}

/**
 * How full a session's context window is. `normalClass` colours the bar
 * below the warning level, so each surface keeps its own accent.
 */
export function ContextFillBar({
  view,
  normalClass,
}: {
  view: ContextFillView
  normalClass: string
}): React.JSX.Element {
  return (
    <div
      role="meter"
      aria-label="Context window used"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.floor(view.percent)}
      aria-valuetext={view.description}
      className="h-1 w-full rounded-full bg-muted overflow-hidden"
    >
      <div
        className={cn(
          'h-full rounded-full transition-all duration-500',
          view.level === 'normal' ? normalClass : LEVEL_CLASS[view.level]
        )}
        style={{ width: `${view.percent}%` }}
      />
    </div>
  )
}
