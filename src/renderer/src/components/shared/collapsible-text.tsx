import React, { useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { MESSAGE_COLLAPSE_MAX_HEIGHT_PX, MESSAGE_COLLAPSE_SLACK_PX } from '@shared/constants/tuning'
import { cn } from '@renderer/lib/cn'
import { hiddenLines, needsCollapse } from './collapsible-text-rules'

interface CollapsibleTextProps {
  children: React.ReactNode
  /**
   * Open regardless of the reader's choice until they make one — the
   * in-session search matched text the clamp would hide.
   */
  forceOpen?: boolean
  /** `inverted` for the user's blue bubble: the fade and control take its colours. */
  variant?: 'default' | 'inverted'
  className?: string
}

/**
 * Clamps a long message body behind a "Show more" control.
 *
 * The full content is always rendered; the clamp is a `max-height` with a
 * fade, and the control only appears once the content is measured to
 * overflow it (see `collapsible-text-rules.ts`). A short message gets no
 * button and no layout shift. State is per mount, so a bubble the reader
 * opened stays open across watcher re-renders and closes when they leave
 * the session.
 */
export default function CollapsibleText({
  children,
  forceOpen = false,
  variant = 'default',
  className,
}: CollapsibleTextProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [contentHeight, setContentHeight] = useState(0)
  const [lineHeight, setLineHeight] = useState(0)
  const [chosen, setChosen] = useState<boolean | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = (): void => {
      setContentHeight(el.scrollHeight)
      // The wrapper inherits whatever line-height its parent has (often
      // `normal`, which is not a number); the content root sets its own.
      const content = el.firstElementChild ?? el
      setLineHeight(parseFloat(window.getComputedStyle(content).lineHeight))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const overflows = needsCollapse(
    contentHeight,
    MESSAGE_COLLAPSE_MAX_HEIGHT_PX,
    MESSAGE_COLLAPSE_SLACK_PX
  )
  const open = chosen ?? forceOpen
  const collapsed = overflows && !open
  const inv = variant === 'inverted'

  // Closing a long body from its bottom would leave the reader somewhere
  // below the message; bring the top of it back into view. Done after the
  // collapse has committed: before it, the element is still full height and
  // already "in view", so a scroll requested from the click handler is a no-op.
  const scrollBackOnCollapse = useRef(false)
  useLayoutEffect(() => {
    if (!scrollBackOnCollapse.current) return
    scrollBackOnCollapse.current = false
    ref.current?.scrollIntoView({ block: 'nearest' })
  })

  const toggle = (): void => {
    const next = !open
    setChosen(next)
    scrollBackOnCollapse.current = !next
  }

  return (
    <div className={cn('relative', className)}>
      <div
        ref={ref}
        className={cn(collapsed && 'overflow-hidden')}
        style={collapsed ? { maxHeight: MESSAGE_COLLAPSE_MAX_HEIGHT_PX } : undefined}
      >
        {children}
      </div>
      {collapsed && (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-x-0 bottom-6 h-12 bg-gradient-to-t to-transparent',
            inv ? 'from-blue-600' : 'from-background'
          )}
        />
      )}
      {overflows && (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className={cn(
            'mt-1 inline-flex h-5 items-center gap-1 text-[11px] font-medium transition-colors',
            inv ? 'text-white/80 hover:text-white' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {open ? (
            <ChevronUp className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronDown className="h-3 w-3 shrink-0" />
          )}
          {open ? 'Show less' : 'Show more'}
          {!open && lineHeight > 0 && (
            <span className="opacity-70">
              · ~{hiddenLines(contentHeight, MESSAGE_COLLAPSE_MAX_HEIGHT_PX, lineHeight)} lines
            </span>
          )}
        </button>
      )}
    </div>
  )
}
