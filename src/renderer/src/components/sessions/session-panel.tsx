import React, { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react'
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
import { windowAfterScroll, windowAfterAppend, scrollTopAfterPrepend } from './render-window'
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

// Progressive rendering, newest first: mount the last INITIAL_RENDER_BATCH
// records, open scrolled to the bottom, and mount older records in
// INCREMENT_RENDER_BATCH chunks as the reader scrolls within RENDER_AHEAD_PX
// of the oldest mounted one. Keeps first-paint cheap even on sessions with
// hundreds of turns. Rules live in `render-window.ts`.
const INITIAL_RENDER_BATCH = 50
const INCREMENT_RENDER_BATCH = 50
const RENDER_AHEAD_PX = 1500

// ─── Session lint flag evaluation (mirrors SES001–SES006 thresholds) ──────────

const SES_THRESHOLDS = {
  cost: 25.0,
  compactions: 5,
  tokens: 2_000_000,
  staleDays: 14,
  // Halved when message counting moved from records to API responses: the old
  // value of 10 was calibrated against counts inflated ~2.09x.
  staleMinMessages: 5,
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
  // Mirror of `visibleCount` for the scroll handler and the layout effect.
  // Bumped eagerly when a grow is requested, so two scroll events arriving
  // before the commit don't both request the same batch; resynced from state
  // on every commit.
  const visibleCountRef = useRef(INITIAL_RENDER_BATCH)
  // Set when the next commit should land the reader on the newest record: a
  // fresh session, a new search, or a live append while they were already at
  // the bottom. Consumed by the layout effect below.
  const scrollToEndRef = useRef(true)
  // Scroll geometry captured just before older records are mounted above the
  // viewport, so the layout effect can put the same record back under the
  // reader's eye. Null when the last window change was not a prepend.
  const pendingPrependRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null)
  // Filtered record count from the previous commit, keyed by what it was
  // counted for, so a live append can be told apart from a session switch or
  // a search change (both of which reset the window instead).
  const prevTotalRef = useRef<{ sessionId: string | null; query: string; total: number } | null>(
    null
  )

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

  // Mount older records when the reader is within RENDER_AHEAD_PX of the
  // oldest mounted one. Captures the scroll geometry first so the commit can
  // be anchored; returns whether the window grew.
  const growTowardTop = useCallback((el: HTMLDivElement): boolean => {
    const current = visibleCountRef.current
    const next = windowAfterScroll(
      current,
      totalRecordsRef.current,
      el.scrollTop,
      INCREMENT_RENDER_BATCH,
      RENDER_AHEAD_PX
    )
    if (next === current) return false
    visibleCountRef.current = next
    // Keep the earliest geometry if a second grow is requested before the
    // first commits: the anchor is measured against the height both add.
    pendingPrependRef.current ??= { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight }
    setVisibleCount(next)
    return true
  }, [])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    isAtBottomRef.current = distanceFromBottom <= SCROLL_BOTTOM_THRESHOLD_PX
    if (isAtBottomRef.current) setShowScrollButton(false)
    growTowardTop(el)
  }, [growTowardTop])

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
  // Records the panel shows: the role filter, then the search filter.
  // Memoised so the effects below can key on it.
  const filteredRecords = React.useMemo(() => {
    if (!parsedSession) return []
    const display = parsedSession.records.filter(
      (r) =>
        r.isCompactionBoundary || r.role === 'user' || r.role === 'assistant' || r.role === 'system'
    )
    if (!searchQuery) return display
    const q = searchQuery.toLowerCase()
    return display.filter((r) => {
      if (r.isCompactionBoundary) return false
      return r.contentBlocks.some((b) => {
        if (b.type === 'text') return b.text.toLowerCase().includes(q)
        if (b.type === 'thinking') return b.thinking.toLowerCase().includes(q)
        return false
      })
    })
  }, [parsedSession, searchQuery])
  // Render-ahead ceiling for the scroll handler and the anchoring layout
  // effect. A layout effect, declared before that one, so the first commit
  // of a session sees its own length rather than the previous session's.
  useLayoutEffect(() => {
    totalRecordsRef.current = filteredRecords.length
  }, [filteredRecords])
  // A fresh session or a new search opens on its newest record. Keyed on the
  // parsed session's id as well: the store can show the previous session
  // under the new selection for a frame. Declared before the anchoring
  // layout effect below so it runs first in the same commit (layout effects
  // fire in declaration order).
  useLayoutEffect(() => {
    scrollToEndRef.current = true
    pendingPrependRef.current = null
  }, [parsedSession?.id, activeSessionId, searchQuery])
  // Also a layout effect, and also declared before the anchoring one: it
  // must see the committed count, not the previous session's.
  useLayoutEffect(() => {
    visibleCountRef.current = visibleCount
  }, [visibleCount])
  // Reset the at-bottom tracker after the session-switch render commits, so
  // the next scroll handler treats the fresh session as starting at bottom.
  useEffect(() => {
    isAtBottomRef.current = true
  }, [activeSessionId])

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  // Absorb live appends into the window. A refresh of the same parsed session
  // (same id, new object) with more records is an append: grow the window by
  // the new records so the oldest mounted one stays put, and keep a reader
  // who was at the bottom there. A session arriving after the loading state,
  // or a different session, is a fresh view and is reset by the layout
  // effects above.
  useEffect(() => {
    const total = filteredRecords.length
    const prev = prevTotalRef.current
    prevTotalRef.current = { sessionId: parsedSession?.id ?? null, query: searchQuery, total }
    if (!parsedSession || !prev) return
    if (prev.sessionId !== parsedSession.id || prev.query !== searchQuery) return
    setVisibleCount((c) => windowAfterAppend(c, prev.total, total))
    if (total > prev.total && isAtBottomRef.current) scrollToEndRef.current = true
  }, [parsedSession, filteredRecords, searchQuery])

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

  // Runs after every commit that can move content above the viewport. Lands a
  // fresh view on the newest record, or puts the anchored record back after a
  // prepend, then keeps mounting older records while the top is still within
  // reach — a first batch shorter than the viewport can never be scrolled up
  // to, so the fill has to be driven from here. Bounded: each pass either
  // grows the window or stops.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (scrollToEndRef.current) {
      scrollToEndRef.current = false
      pendingPrependRef.current = null
      el.scrollTop = el.scrollHeight
      isAtBottomRef.current = true
    } else if (pendingPrependRef.current) {
      const { scrollTop, scrollHeight } = pendingPrependRef.current
      pendingPrependRef.current = null
      el.scrollTop = scrollTopAfterPrepend(scrollTop, scrollHeight, el.scrollHeight)
    }
    // Content shorter than the viewport has nowhere to scroll: keep it pinned
    // to the bottom while more of the history is mounted behind it.
    if (el.scrollHeight <= el.clientHeight) scrollToEndRef.current = true
    if (!growTowardTop(el)) scrollToEndRef.current = false
  })

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

  const { toolResultMap, metadata } = parsedSession

  const turnDurationByTimestamp = new Map(
    metadata.turnDurations
      .filter((t) => t.assistantTimestamp)
      .map((t) => [t.assistantTimestamp!, t])
  )

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
                {activeSessionSummary?.title ?? parsedSession.slug ?? parsedSession.id.slice(0, 12)}
              </h2>
              <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground flex-wrap">
                {metadata.firstTimestamp && (
                  <span>{format(new Date(metadata.firstTimestamp), 'MMM d, yyyy HH:mm')}</span>
                )}
                {metadata.firstTimestamp && metadata.lastTimestamp && <span>→</span>}
                {metadata.lastTimestamp && (
                  <span>{format(new Date(metadata.lastTimestamp), 'HH:mm')}</span>
                )}
                {/* Parent-only, matching the messages count beside it. The
                    combined figure is shown when subagents contributed, so the
                    header cannot silently disagree with the session list. */}
                <span className="font-mono">
                  {formatTokens(totalTokens)} fresh input + output
                  {activeSessionSummary &&
                    activeSessionSummary.totalInputTokens + activeSessionSummary.totalOutputTokens >
                      totalTokens && (
                      <span className="ml-1 text-muted-foreground/60">
                        (
                        {formatTokens(
                          activeSessionSummary.totalInputTokens +
                            activeSessionSummary.totalOutputTokens
                        )}{' '}
                        incl. subagents)
                      </span>
                    )}
                </span>
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
          {/* overflow-anchor is off: the layout effect above does its own
              anchoring after a prepend, and Chromium's would double-correct. */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="h-full overflow-y-auto py-2"
            style={{ overflowAnchor: 'none' }}
          >
            {filteredRecords.length === 0 && searchQuery && (
              <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                No messages match &quot;{searchQuery}&quot;
              </div>
            )}
            {visibleCount < filteredRecords.length && (
              <div className="flex items-center justify-center py-4 text-[11px] text-muted-foreground/60">
                Loading older messages…
              </div>
            )}
            {filteredRecords
              .slice(Math.max(0, filteredRecords.length - visibleCount))
              .map((record) => (
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
