import React, { useState, useRef, useCallback, useEffect } from 'react'
import {
  Search,
  X,
  Download,
  RefreshCw,
  ArrowDown,
  Info,
  ShieldAlert,
  GitBranch,
  Layers,
} from 'lucide-react'
import { EmptyState } from '@renderer/components/shared/empty-state'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { format } from 'date-fns'
import { useSessionsStore } from '@renderer/store/sessions.store'
import { useUIStore } from '@renderer/store/ui.store'
import { useFeatureFlags } from '@renderer/store/feature-flags.store'
import { formatTokens } from '@shared/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@renderer/components/ui/tooltip'
import MessageBubble from './message-bubble'
import SessionDetailsPanel from './session-details-panel'
import type { LintCheckId, LintSeverity, SessionSummary } from '@shared/types'

const SCROLL_BOTTOM_THRESHOLD_PX = 80

// Progressive rendering: render the first INITIAL_RENDER_BATCH records on
// mount, then expand the window in INCREMENT_RENDER_BATCH chunks during idle
// time (or when the user scrolls within RENDER_AHEAD_PX of the rendered tail)
// until the full record set is mounted. Keeps first-paint cheap even on
// sessions with hundreds of turns.
const INITIAL_RENDER_BATCH = 50
const INCREMENT_RENDER_BATCH = 50
const RENDER_AHEAD_PX = 1500

// ─── Session lint flag evaluation (mirrors SES001–SES006 thresholds) ──────────

const SES_THRESHOLDS = {
  cost: 25.0,
  compactions: 5,
  tokens: 2_000_000,
  staleDays: 14,
  staleMinMessages: 10,
}

function evaluateSessionLintFlags(session: SessionSummary): {
  flags: LintCheckId[]
  severity: LintSeverity | null
} {
  const flags: LintCheckId[] = []
  const totalTokens = session.totalInputTokens + session.totalOutputTokens
  const staleMs = SES_THRESHOLDS.staleDays * 24 * 60 * 60 * 1000

  if (session.estimatedCost > SES_THRESHOLDS.cost) flags.push('SES001')
  if (session.compactionCount >= SES_THRESHOLDS.compactions) flags.push('SES002')
  if (totalTokens > SES_THRESHOLDS.tokens) flags.push('SES003')
  if (
    Date.now() - new Date(session.lastTimestamp).getTime() > staleMs &&
    session.messageCount >= SES_THRESHOLDS.staleMinMessages
  ) {
    flags.push('SES004')
  }
  if (session.hasError) flags.push('SES005')
  if (session.observability.hasIdleZombieGap) flags.push('SES006')

  if (flags.length === 0) return { flags, severity: null }
  const warningFlags: LintCheckId[] = ['SES001', 'SES002', 'SES003', 'SES005', 'SES006']
  const severity: LintSeverity = flags.some((f) => warningFlags.includes(f)) ? 'warning' : 'info'
  return { flags, severity }
}

const FLAG_DESCRIPTIONS: Partial<Record<LintCheckId, string>> = {
  SES001: 'Cost exceeds $25',
  SES002: '5+ compaction cycles',
  SES003: 'More than 2M tokens consumed',
  SES004: 'Stale session (14+ days)',
  SES005: 'Error patterns detected',
  SES006: 'Idle/zombie gap detected',
}

interface SessionLintBadgeProps {
  flags: LintCheckId[]
  severity: LintSeverity
  onClickLint: () => void
}

const TAG_META: Record<
  string,
  { label: string; icon: React.ElementType; className: string; tooltip: string }
> = {
  'parallel-threads': {
    label: 'Parallel threads',
    icon: GitBranch,
    className: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-600',
    tooltip: 'This session used parallel tool calls in multiple turns',
  },
}

function SessionTagBadge({ tag }: { tag: string }): React.JSX.Element | null {
  const meta = TAG_META[tag]
  if (!meta) return null
  const Icon = meta.icon
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${meta.className}`}
          >
            <Icon className="h-3 w-3 shrink-0" />
            {meta.label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[220px] text-[10px]">
          {meta.tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function SessionLintBadge({
  flags,
  severity,
  onClickLint,
}: SessionLintBadgeProps): React.JSX.Element {
  const colorClass =
    severity === 'error'
      ? 'border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20'
      : severity === 'warning'
        ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20'
        : 'border-blue-500/40 bg-blue-500/10 text-blue-600 hover:bg-blue-500/20'

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onClickLint}
            className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${colorClass}`}
          >
            <ShieldAlert className="h-3 w-3 shrink-0" />
            {flags.length} lint {flags.length === 1 ? 'issue' : 'issues'}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[220px] text-[10px]">
          <p className="font-semibold mb-1">{flags.join(', ')}</p>
          <ul className="space-y-0.5">
            {flags.map((f) => (
              <li key={f} className="text-muted-foreground">
                <span className="font-medium text-foreground">{f}:</span>{' '}
                {FLAG_DESCRIPTIONS[f] ?? f}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-muted-foreground">Click to view in Lint panel</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export default function SessionPanel(): React.JSX.Element {
  const {
    parsedSession,
    isLoadingSession,
    isRefreshingSession,
    sessionError,
    activeSessionId,
    projects,
  } = useSessionsStore()
  const { setView } = useUIStore()
  const lintEnabled = useFeatureFlags((s) => s.lint)
  const sessionExportEnabled = useFeatureFlags((s) => s.sessionExport)

  const activeSessionSummary = React.useMemo(() => {
    if (!activeSessionId) return null
    for (const p of projects) {
      const s = p.sessions.find((s) => s.id === activeSessionId)
      if (s) return s
    }
    return null
  }, [projects, activeSessionId])

  const sessionLint = React.useMemo(
    () => (activeSessionSummary ? evaluateSessionLintFlags(activeSessionSummary) : null),
    [activeSessionSummary]
  )

  const sessionTags = React.useMemo(() => {
    if (!activeSessionSummary) return []
    const auto: string[] = []
    if (activeSessionSummary.observability.parallelToolCallCount > 0) auto.push('parallel-threads')
    const stored = activeSessionSummary.tags ?? []
    return [...new Set([...auto, ...stored])]
  }, [activeSessionSummary])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [detailsWidth, setDetailsWidth] = useState(256)
  const [visibleCount, setVisibleCount] = useState(INITIAL_RENDER_BATCH)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const detailsPanelRef = useRef<HTMLDivElement>(null)
  const isResizing = useRef(false)
  const isAtBottomRef = useRef(true)
  // Upper bound for the render-ahead logic in the scroll handler. Kept in a
  // ref so the handler doesn't need to close over the latest filtered length.
  const totalRecordsRef = useRef(0)

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizing.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: MouseEvent) => {
      if (!isResizing.current) return
      const container = scrollRef.current?.closest('.session-panel-root') as HTMLElement | null
      if (!container) return
      const right = container.getBoundingClientRect().right
      const newWidth = Math.min(480, Math.max(200, right - ev.clientX))
      detailsPanelRef.current?.style.setProperty('width', `${newWidth}px`)
    }

    const onUp = (ev: MouseEvent) => {
      if (!isResizing.current) return
      isResizing.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      const container = scrollRef.current?.closest('.session-panel-root') as HTMLElement | null
      if (container) {
        const right = container.getBoundingClientRect().right
        setDetailsWidth(Math.min(480, Math.max(200, right - ev.clientX)))
      }
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  const checkIsAtBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    isAtBottomRef.current = distanceFromBottom <= SCROLL_BOTTOM_THRESHOLD_PX
    if (isAtBottomRef.current) setShowScrollButton(false)
    // Eagerly expand the render window when the user scrolls near the rendered
    // tail. Without this the idle scheduler can't keep up with fast scrolling.
    if (distanceFromBottom <= RENDER_AHEAD_PX) {
      setVisibleCount((c) => Math.min(totalRecordsRef.current, c + INCREMENT_RENDER_BATCH))
    }
  }, [])

  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [])

  // Reset state when switching sessions / when the search query changes.
  // Using the "store prev prop, compare during render" pattern instead of a
  // post-render effect so resets happen synchronously with the prop change —
  // see https://react.dev/reference/react/useState#storing-information-from-previous-renders.
  const [prevSessionId, setPrevSessionId] = useState(activeSessionId)
  if (prevSessionId !== activeSessionId) {
    setPrevSessionId(activeSessionId)
    setSearchQuery('')
    setSearchOpen(false)
    setShowScrollButton(false)
    setDetailsOpen(false)
    setVisibleCount(INITIAL_RENDER_BATCH)
  }
  const [prevSearchQuery, setPrevSearchQuery] = useState(searchQuery)
  if (prevSearchQuery !== searchQuery) {
    setPrevSearchQuery(searchQuery)
    setVisibleCount(INITIAL_RENDER_BATCH)
  }
  // Reset the at-bottom tracker after the session-switch render commits, so
  // the next scroll handler treats the fresh session as starting at bottom.
  useEffect(() => {
    isAtBottomRef.current = true
  }, [activeSessionId])

  // Background-expand the render window during idle time until every record
  // is mounted. requestIdleCallback yields between batches so the main thread
  // stays responsive to scroll, search typing, and other interactions.
  useEffect(() => {
    if (!parsedSession) return
    const total = parsedSession.records.length
    if (visibleCount >= total) return
    const ric = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1))
    const cic = window.cancelIdleCallback ?? ((id: number) => window.clearTimeout(id))
    const handle = ric(() => {
      setVisibleCount((c) => Math.min(total, c + INCREMENT_RENDER_BATCH))
    })
    return () => cic(handle as number)
  }, [parsedSession, visibleCount])

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  // Keep the render-ahead ceiling in sync with the current filtered set.
  // Computed here (rather than at the bottom of render) so the ref write
  // happens in an effect, not during render.
  useEffect(() => {
    if (!parsedSession) {
      totalRecordsRef.current = 0
      return
    }
    const display = parsedSession.records.filter(
      (r) =>
        r.isCompactionBoundary || r.role === 'user' || r.role === 'assistant' || r.role === 'system'
    )
    if (!searchQuery) {
      totalRecordsRef.current = display.length
      return
    }
    const q = searchQuery.toLowerCase()
    totalRecordsRef.current = display.filter((r) => {
      if (r.isCompactionBoundary) return false
      return r.contentBlocks.some((b) => {
        if (b.type === 'text') return b.text.toLowerCase().includes(q)
        if (b.type === 'thinking') return b.thinking.toLowerCase().includes(q)
        return false
      })
    }).length
  }, [parsedSession, searchQuery])

  // When a watcher refresh completes, show the scroll button if the user is scrolled up
  const prevRefreshing = useRef(false)
  useEffect(() => {
    const justFinished = prevRefreshing.current && !isRefreshingSession
    prevRefreshing.current = isRefreshingSession
    if (justFinished && !isAtBottomRef.current) {
      setShowScrollButton(true)
    }
  }, [isRefreshingSession])

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom()
    setShowScrollButton(false)
  }, [scrollToBottom])

  if (!activeSessionId) {
    return (
      <EmptyState
        icon={Layers}
        title="No session selected"
        description="Select a session to view the conversation"
      />
    )
  }

  if (isLoadingSession || !parsedSession) {
    return (
      <div className="flex flex-col h-full">
        <div className="border-b border-border/50 p-4 space-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-3 w-64" />
        </div>
        <div className="flex-1 p-4 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      </div>
    )
  }

  if (sessionError) {
    return (
      <div className="flex h-full items-center justify-center text-destructive text-sm px-8 text-center">
        {sessionError}
      </div>
    )
  }

  const { records, toolResultMap, metadata } = parsedSession

  const turnDurationByTimestamp = new Map(
    metadata.turnDurations
      .filter((t) => t.assistantTimestamp)
      .map((t) => [t.assistantTimestamp!, t])
  )

  const displayRecords = records.filter(
    (r) =>
      r.isCompactionBoundary || r.role === 'user' || r.role === 'assistant' || r.role === 'system'
  )

  const filteredRecords = searchQuery
    ? displayRecords.filter((r) => {
        if (r.isCompactionBoundary) return false
        return r.contentBlocks.some((b) => {
          if (b.type === 'text') return b.text.toLowerCase().includes(searchQuery.toLowerCase())
          if (b.type === 'thinking')
            return b.thinking.toLowerCase().includes(searchQuery.toLowerCase())
          return false
        })
      })
    : displayRecords

  const totalTokens = metadata.totalInputTokens + metadata.totalOutputTokens

  return (
    <div className="flex h-full session-panel-root">
      {/* Main conversation column */}
      <div className="flex flex-col flex-1 min-w-0 h-full">
        {/* Session Header */}
        <div className="border-b border-border/50 px-4 py-3 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold truncate text-foreground">
                {parsedSession.slug ?? parsedSession.id.slice(0, 12)}
              </h2>
              <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground flex-wrap">
                {metadata.firstTimestamp && (
                  <span>{format(new Date(metadata.firstTimestamp), 'MMM d, yyyy HH:mm')}</span>
                )}
                {metadata.firstTimestamp && metadata.lastTimestamp && <span>→</span>}
                {metadata.lastTimestamp && (
                  <span>{format(new Date(metadata.lastTimestamp), 'HH:mm')}</span>
                )}
                <span className="font-mono">{formatTokens(totalTokens)} tokens</span>
                <span className="text-muted-foreground/60">
                  {metadata.messageCount} messages
                  {activeSessionSummary &&
                    activeSessionSummary.messageCount > metadata.messageCount && (
                      <span className="ml-1">
                        ({activeSessionSummary.messageCount} incl. subagents)
                      </span>
                    )}
                </span>
                {sessionTags.map((tag) => (
                  <SessionTagBadge key={tag} tag={tag} />
                ))}
                {lintEnabled &&
                  sessionLint &&
                  sessionLint.flags.length > 0 &&
                  sessionLint.severity && (
                    <SessionLintBadge
                      flags={sessionLint.flags}
                      severity={sessionLint.severity}
                      onClickLint={() => setView('lint')}
                    />
                  )}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {isRefreshingSession && (
                <RefreshCw
                  className="h-3 w-3 text-muted-foreground/50 animate-spin"
                  aria-label="Refreshing session…"
                />
              )}
              <button
                onClick={() => setDetailsOpen((v) => !v)}
                className={`p-1.5 rounded transition-colors ${detailsOpen ? 'bg-accent text-foreground' : 'hover:bg-accent text-muted-foreground'}`}
                title="Session details"
              >
                <Info className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setSearchOpen((v) => !v)}
                className="p-1.5 rounded hover:bg-accent transition-colors"
                title="Search (Cmd+F)"
              >
                <Search className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              {sessionExportEnabled && (
                <button
                  className="p-1.5 rounded hover:bg-accent transition-colors"
                  title="Export session"
                >
                  <Download className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              )}
            </div>
          </div>

          {/* Search bar */}
          {searchOpen && (
            <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1">
              <Search className="h-3 w-3 text-muted-foreground shrink-0" />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search in conversation…"
                className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
              />
              {searchQuery && (
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {filteredRecords.length} matches
                </span>
              )}
              <button
                onClick={() => {
                  setSearchQuery('')
                  setSearchOpen(false)
                }}
                className="p-0.5 hover:text-foreground text-muted-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>

        {/* Conversation scroll area */}
        <div className="relative flex-1 min-h-0">
          <div ref={scrollRef} onScroll={checkIsAtBottom} className="h-full overflow-y-auto py-2">
            {filteredRecords.length === 0 && searchQuery && (
              <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                No messages match &quot;{searchQuery}&quot;
              </div>
            )}
            {filteredRecords.slice(0, visibleCount).map((record) => (
              <MessageBubble
                key={record.uuid}
                record={record}
                toolResultMap={toolResultMap}
                searchQuery={searchQuery}
                turnDuration={
                  record.timestamp ? turnDurationByTimestamp.get(record.timestamp) : undefined
                }
                subagents={activeSessionSummary?.subagents}
              />
            ))}
            {visibleCount < filteredRecords.length && (
              <div className="flex items-center justify-center py-4 text-[11px] text-muted-foreground/60">
                Loading older messages…
              </div>
            )}
          </div>

          {/* Scroll-to-bottom button — shown when watcher pushes new messages and user scrolled up */}
          {showScrollButton && (
            <button
              onClick={handleScrollToBottom}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground shadow-lg transition-opacity hover:opacity-90"
            >
              <ArrowDown className="h-3 w-3" />
              New messages
            </button>
          )}
        </div>
      </div>

      {/* Details side panel — resizable right side */}
      {detailsOpen && (
        <div
          ref={detailsPanelRef}
          className="flex shrink-0 border-l border-border/50"
          style={{ width: detailsWidth }}
        >
          {/* Drag handle */}
          <div
            role="slider"
            aria-label="Resize panel"
            aria-orientation="vertical"
            aria-valuenow={0}
            tabIndex={0}
            onMouseDown={startResize}
            className="w-1 cursor-col-resize hover:bg-primary/40 transition-colors shrink-0"
          />
          <div className="flex-1 min-w-0">
            <SessionDetailsPanel onClose={() => setDetailsOpen(false)} />
          </div>
        </div>
      )}
    </div>
  )
}
