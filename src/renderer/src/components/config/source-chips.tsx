import React from 'react'
import { cn } from '@renderer/lib/cn'

export interface SourceChipOption<V extends string> {
  value: V
  label: string
  count: number
}

/**
 * A row of single-choice filter chips with counts, shown under the search box
 * of the setup sidebars (Hooks, Commands, Skills, Plans). A chip whose count
 * is zero is greyed and can't be chosen, except the one already active, so a
 * filter that empties after a refresh can still be switched off.
 */
export function SourceChips<V extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: SourceChipOption<V>[]
  value: V
  onChange: (value: V) => void
  /** Accessible name of the group, e.g. "Filter commands by source". */
  label: string
}): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex flex-wrap gap-1 px-2 py-1.5 border-b border-border/30"
    >
      {options.map((o) => {
        const active = o.value === value
        const disabled = o.count === 0 && !active
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              // `!` on the border colour: the unlayered `* { border-color }`
              // reset in index.css outranks Tailwind's layered utilities.
              active
                ? 'border-primary/40! bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
              disabled &&
                'opacity-40 cursor-not-allowed hover:bg-transparent hover:text-muted-foreground'
            )}
          >
            {o.label}
            <span className="tabular-nums opacity-70">{o.count}</span>
          </button>
        )
      })}
    </div>
  )
}
