import React from 'react'
import { Clock } from 'lucide-react'
import { formatCost, formatTokens } from '@shared/utils'
import { isSubagentRunning } from '@shared/utils/live-session'
import { ipc } from '@renderer/lib/ipc-client'
import { useSettingsStore } from '@renderer/store/settings.store'
import { useNow } from '@renderer/hooks/use-now'
import { getModelMeta } from '@renderer/lib/model-meta'
import { Skeleton } from '@renderer/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@renderer/components/ui/dialog'
import MessageBubble from '@renderer/components/sessions/message-bubble'
import { groupResponses } from '@renderer/components/sessions/assistant-response'
import {
  formatAgentDuration,
  subagentDurationMs,
} from '@renderer/components/sessions/subagent-card'
import {
  INCREMENT_RENDER_BATCH,
  INITIAL_RENDER_BATCH,
  RENDER_AHEAD_PX,
  prefixWindowAfterAppend,
  windowAfterScroll,
} from '@renderer/components/sessions/render-window'
import type { ParsedSession, SubagentSummary } from '@shared/types'

/** A sub-agent's conversation in a dialog over the session. */
export function SubagentConversationDialog({
  subagent,
  onClose,
  ...props
}: {
  sessionId: string
  projectId: string
  /** The sub-agent to show; null keeps the dialog closed. */
  subagent: SubagentSummary | null
  subagents: SubagentSummary[]
  onClose: () => void
}): React.JSX.Element {
  return (
    <Dialog open={subagent !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[85vh] w-[92vw] max-w-5xl flex-col overflow-hidden p-0">
        <DialogDescription className="sr-only">
          The sub-agent’s prompt, reasoning, tool calls and report
        </DialogDescription>
        {subagent && <SubagentTranscript subagent={subagent} {...props} />}
      </DialogContent>
    </Dialog>
  )
}

/**
 * One sub-agent's own conversation: the prompt its parent gave it, its
 * reasoning and tool calls, and the report it returned. Re-read whenever the
 * session summary says the sub-agent wrote more.
 */
export function SubagentTranscript({
  sessionId,
  projectId,
  subagent,
  subagents,
}: {
  sessionId: string
  projectId: string
  subagent: SubagentSummary
  /** Every sub-agent of the session, for nested runs started from this one. */
  subagents: SubagentSummary[]
}): React.JSX.Element {
  const [parsed, setParsed] = React.useState<ParsedSession | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const now = useNow()
  const running = isSubagentRunning(subagent, now)
  // Main redacts on the way out; a new setting needs a refetch.
  const redactionLevel = useSettingsStore((st) => st.prefs.redactionLevel)
  // Progressive rendering from the prompt down: the first INITIAL_RENDER_BATCH
  // records, then INCREMENT_RENDER_BATCH more each time the reader comes
  // within RENDER_AHEAD_PX of the last mounted one. See `render-window.ts`.
  const [visibleCount, setVisibleCount] = React.useState(INITIAL_RENDER_BATCH)
  const scrollRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    let cancelled = false
    ipc.sessions
      .getSubagent(sessionId, projectId, subagent.agentId)
      .then((result) => {
        if (cancelled) return
        if (result.ok) {
          setParsed(result.data)
          setError(null)
        } else {
          setError(result.error)
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
    // lastTimestamp and messageCount move on every write the watcher reports.
  }, [
    sessionId,
    projectId,
    subagent.agentId,
    subagent.lastTimestamp,
    subagent.messageCount,
    redactionLevel,
  ])

  // Opened on a different agent: drop the previous one's transcript at once.
  const [shownAgentId, setShownAgentId] = React.useState(subagent.agentId)
  if (shownAgentId !== subagent.agentId) {
    setShownAgentId(subagent.agentId)
    setParsed(null)
    setError(null)
    setVisibleCount(INITIAL_RENDER_BATCH)
  }

  const records = React.useMemo(
    () =>
      parsed
        ? groupResponses(parsed.records).filter(
            (r) =>
              r.isCompactionBoundary ||
              r.role === 'user' ||
              r.role === 'assistant' ||
              r.role === 'system'
          )
        : [],
    [parsed]
  )
  // A re-read after the agent wrote more: keep up with the tail only if the
  // reader already had all of it mounted.
  const [prevTotal, setPrevTotal] = React.useState(records.length)
  if (prevTotal !== records.length) {
    setPrevTotal(records.length)
    setVisibleCount((c) => prefixWindowAfterAppend(c, prevTotal, records.length))
  }

  const growTowardBottom = React.useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setVisibleCount((c) =>
      windowAfterScroll(
        c,
        records.length,
        distanceFromBottom,
        INCREMENT_RENDER_BATCH,
        RENDER_AHEAD_PX
      )
    )
  }, [records.length])

  // A first batch shorter than the viewport cannot be scrolled, so keep
  // mounting until the window reaches past the look-ahead or runs out.
  // Bounded: each pass either grows the window or leaves it unchanged.
  React.useLayoutEffect(() => {
    growTowardBottom()
  }, [growTowardBottom, visibleCount, parsed])

  const turnDurationByTimestamp = React.useMemo(
    () =>
      new Map(
        (parsed?.metadata.turnDurations ?? [])
          .filter((t) => t.assistantTimestamp)
          .map((t) => [t.assistantTimestamp!, t])
      ),
    [parsed]
  )
  const children = React.useMemo(
    () => subagents.filter((s) => s.parentAgentId === subagent.agentId),
    [subagents, subagent.agentId]
  )

  const meta = subagent.primaryModel ? getModelMeta(subagent.primaryModel) : null
  const durationMs = subagentDurationMs(subagent)
  const promptAuthor = subagent.parentAgentId
    ? `Prompt from sub-agent ${subagent.parentAgentId}`
    : 'Prompt from the session'

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Right padding leaves room for the dialog's close button. */}
      <div className="shrink-0 border-b border-border/50 py-3 pl-4 pr-12">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <DialogTitle className="flex items-center gap-1.5 truncate text-sm font-semibold text-foreground">
              {running && (
                <span
                  className="block h-2 w-2 shrink-0 rounded-full bg-green-500 animate-pulse"
                  aria-label="Running"
                />
              )}
              {subagent.description ?? subagent.agentId}
            </DialogTitle>
            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{subagent.agentId}</p>
          </div>
          {meta && (
            <span
              className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${meta.badgeClass}`}
            >
              {meta.label}
            </span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {subagent.agentType && (
            <span className="rounded-sm bg-violet-500/15 px-1 py-0.5 font-medium text-violet-500">
              {subagent.agentType}
            </span>
          )}
          {subagent.isBackground && <span>background</span>}
          {durationMs > 0 && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {running ? 'running · ' : ''}
              {formatAgentDuration(durationMs)}
              {subagent.durationSource === 'span' && '~'}
            </span>
          )}
          <span>{subagent.messageCount} messages</span>
          <span>{formatTokens(subagent.totalInputTokens + subagent.totalOutputTokens)} tokens</span>
          <span>{formatCost(subagent.estimatedCost)}</span>
          {children.length > 0 && (
            <span>
              started {children.length} sub-agent{children.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={growTowardBottom}
        className="min-h-0 flex-1 overflow-y-auto py-2"
      >
        {error ? (
          <p className="px-4 py-8 text-center text-sm text-destructive">
            Could not read this sub-agent’s transcript: {error}
          </p>
        ) : !parsed ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : records.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            This sub-agent’s transcript has no messages.
          </p>
        ) : (
          records
            .slice(0, visibleCount)
            .map((record) => (
              <MessageBubble
                key={record.uuid}
                record={record}
                toolResultMap={parsed.toolResultMap}
                turnDuration={
                  record.timestamp ? turnDurationByTimestamp.get(record.timestamp) : undefined
                }
                subagents={children}
                promptAuthor={record.queued ? 'Sent by you while it ran' : promptAuthor}
              />
            ))
        )}
        {parsed && visibleCount < records.length && (
          <div className="flex items-center justify-center py-4 text-[11px] text-muted-foreground/60">
            Loading more messages…
          </div>
        )}
      </div>
    </div>
  )
}
