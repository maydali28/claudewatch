import React from 'react'
import { X, Clock, Zap, AlertCircle, Layers, Cpu, Bot, Info, Scissors } from 'lucide-react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { format, formatDuration, intervalToDuration } from 'date-fns'
import { useSessionsStore } from '@renderer/store/sessions.store'
import { useSettingsStore } from '@renderer/store/settings.store'
import { formatTokens, formatCost } from '@shared/utils'
import { getModelMeta } from '@renderer/lib/model-meta'
import { getActivePricingTable } from '@shared/constants/pricing'
import { getModelFamily } from '@shared/constants/models'
import { EmptyState } from '@renderer/components/shared/empty-state'
import type { SubagentSummary } from '@shared/types'

interface SessionDetailsPanelProps {
  onClose: () => void
}

function durationLabel(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const dur = intervalToDuration({ start: 0, end: ms })
  return formatDuration(dur, { format: ['hours', 'minutes', 'seconds'], zero: false }) || '<1s'
}

function StatRow({
  label,
  value,
  hint,
}: {
  label: string
  value: React.ReactNode
  hint?: string
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-border/30 last:border-0">
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {label}
        {hint && (
          <Tooltip.Root delayDuration={200}>
            <Tooltip.Trigger asChild>
              <span className="inline-flex cursor-help">
                <Info className="h-2.5 w-2.5 shrink-0 opacity-70 hover:opacity-100 transition-opacity" />
              </span>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                side="right"
                sideOffset={6}
                className="z-50 max-w-[220px] rounded-md bg-popover px-2.5 py-1.5 text-[11px] text-popover-foreground shadow-md border border-border/50 animate-in fade-in-0 zoom-in-95"
              >
                {hint}
                <Tooltip.Arrow className="fill-popover" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        )}
      </span>
      <span className="text-[11px] font-medium text-foreground text-right">{value}</span>
    </div>
  )
}

function SectionHeader({
  icon: Icon,
  title,
}: {
  icon: React.ElementType
  title: string
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5 mt-4 mb-1.5">
      <Icon className="h-3 w-3 text-muted-foreground" />
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </span>
    </div>
  )
}

function SubagentCard({ subagent }: { subagent: SubagentSummary }): React.JSX.Element {
  const meta = subagent.primaryModel ? getModelMeta(subagent.primaryModel) : null
  const totalTokens = subagent.totalInputTokens + subagent.totalOutputTokens

  return (
    <div className="rounded-md border border-border/50 bg-muted/20 px-2.5 py-2">
      <div className="flex items-center justify-between gap-1 mb-0.5">
        <span className="text-[10px] font-mono text-muted-foreground truncate flex-1">
          {subagent.agentId}
        </span>
        {meta && (
          <span
            className={`shrink-0 rounded-sm px-1 py-0.5 text-[10px] font-medium ${meta.badgeClass}`}
          >
            {meta.label}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 mt-0.5">
        <span className="text-[10px] text-muted-foreground">
          {formatTokens(totalTokens)} tokens
        </span>
        <span className="text-[10px] text-muted-foreground/50">·</span>
        <span className="text-[10px] text-muted-foreground">{subagent.messageCount} msgs</span>
        <span className="text-[10px] text-muted-foreground/50">·</span>
        <span className="text-[10px] text-muted-foreground">
          {formatCost(subagent.estimatedCost)}
        </span>
      </div>
    </div>
  )
}

export default function SessionDetailsPanel({
  onClose,
}: SessionDetailsPanelProps): React.JSX.Element {
  const { parsedSession, projects } = useSessionsStore()
  // Active rates, not the built-in constant — an override left this panel's
  // hypothetical resend-cost and cache-rate hints disagreeing with the actual
  // costs shown elsewhere, which are priced from the active table in the main
  // process.
  const { prefs } = useSettingsStore()
  const pricingTable = React.useMemo(() => getActivePricingTable(prefs), [prefs])

  if (!parsedSession) {
    return (
      <EmptyState
        icon={Layers}
        title="No session selected"
        description="Choose a session from the sidebar to view its details"
      />
    )
  }

  const { metadata } = parsedSession
  const subagentTotals = parsedSession.subagentTotals ?? {
    inputTokens: 0,
    outputTokens: 0,
    messageCount: 0,
    estimatedCost: 0,
  }
  const sessionTokens = metadata.totalInputTokens + metadata.totalOutputTokens

  const sessionSummary = projects.flatMap((p) => p.sessions).find((s) => s.id === parsedSession.id)

  // estimatedCost comes from SessionSummary (includes subagent rollup from parseSessionMetadata)
  const totalCost = sessionSummary?.estimatedCost
  const subagents = sessionSummary?.subagents ?? []
  // Actual child presence, not token volume: a subagent with only user-turn or
  // cache-only activity contributes zero to `subagentTotals.inputTokens` and
  // `.outputTokens`, which would otherwise make a real child session vanish
  // from the scope controls and the message breakdown below. `subagents` is
  // the discovered-children array `metadata-parser.ts` already produces for
  // this session (see its `parseSubagents` call) — reused here rather than
  // scanned or parsed again.
  const hasSubagents = subagents.length > 0
  // Derive session-only cost: total minus subagent costs
  const subagentsCost = subagents.reduce((s, a) => s + a.estimatedCost, 0)
  const sessionOnlyCost = totalCost !== undefined ? totalCost - subagentsCost : undefined

  const sessionDurationMs =
    metadata.firstTimestamp && metadata.lastTimestamp
      ? new Date(metadata.lastTimestamp).getTime() - new Date(metadata.firstTimestamp).getTime()
      : 0

  // ── Context efficiency (compaction) ──────────────────────────────────────────
  // `totalTokensRemoved` sums each event's pre-compaction context size — an
  // observed high-water mark, not a measurement of what was actually freed. A
  // summary is retained after compaction, the summarisation call itself is
  // billed, and later requests still draw on cache — none of that is netted
  // out here, so the UI must present this as "Pre-compaction context", never
  // as tokens removed.
  const compactionEvents = metadata.compactionEvents ?? []
  const totalTokensRemoved = compactionEvents.reduce((sum, e) => sum + (e.preTokens ?? 0), 0)
  const peakContextTokens =
    compactionEvents.length > 0 ? Math.max(...compactionEvents.map((e) => e.preTokens ?? 0)) : 0
  const primaryModel = sessionSummary?.dominantModel ?? metadata.models[0]
  // Null when the model is unrecognised. `unknown` prices at zero, so a numeric
  // fallback here would render a confident $0.00 that reads as "no compaction
  // happened" rather than "we cannot price this". Also drives the cache-rate
  // wording below, since both describe this session's own model.
  //
  // Even when priced, this is a hypothetical: it charges the whole
  // pre-compaction total once at this model's fresh-input rate, as if it had
  // all been re-sent instead of compacted — ignoring the retained summary,
  // the summarisation call's own cost, and any cache reuse a re-send might
  // have gotten. Not a measured saving; the UI must label it as an estimate.
  const dominantModelFamily = getModelFamily(primaryModel)
  const hypotheticalResendCost =
    dominantModelFamily === 'unknown'
      ? null
      : (totalTokensRemoved / 1_000_000) * pricingTable[dominantModelFamily].input

  // Cache rates are not one flat multiplier: Fable 5.1 / Mythos 5.1 read from
  // cache at 2.5% of input while older models read at up to 10%, and writes
  // have two tiers — 125% for a 5-minute write, 200% for a one-hour write —
  // not the single 125% this tooltip used to quote. Deriving the percentages
  // from this model's own ModelPricing entry keeps the wording correct as
  // rates and models change, rather than re-hardcoding a new pair of numbers.
  const dominantPricing =
    dominantModelFamily === 'unknown' ? null : pricingTable[dominantModelFamily]
  const ratePercent = (tierRate: number): string => {
    const pct = Math.round((tierRate / (dominantPricing?.input ?? 1)) * 1000) / 10
    return Number.isInteger(pct) ? `${pct}` : pct.toFixed(1)
  }
  const cacheReadHint = dominantPricing
    ? `Tokens served from Anthropic's prompt cache — billed at ${ratePercent(dominantPricing.cacheRead)}% of this model's input rate`
    : "Tokens served from Anthropic's prompt cache at a reduced rate — this session's model is unrecognised, so no rate can be quoted"
  const cacheWriteHint = dominantPricing
    ? `Tokens written into the prompt cache — billed at ${ratePercent(dominantPricing.cache5m)}% (5-minute) or ${ratePercent(dominantPricing.cache1h)}% (1-hour) of this model's input rate, amortised over future reads`
    : "Tokens written into the prompt cache at a premium over input — this session's model is unrecognised, so no rate can be quoted"

  // Bad input this session's parse could not simply absorb — see
  // `SessionSummary.diagnostics`. `sessionSummary` (not `parsedSession`) is
  // the source: it's the metadata-parser pass that produces this field.
  // Lines and files are different things — a bad subagent transcript is a
  // whole unreadable file, not a line — so they're reported separately
  // rather than summed into one figure that would misdescribe either.
  const diagnostics = sessionSummary?.diagnostics
  // Each count below is independent and renders as its own sentence — see the
  // diagnostics blocks further down. A session can trip exactly one of them
  // (e.g. only a rejected negative counter), so each gate must OR every count
  // in its class rather than checking a subset.
  //
  // Split into the same two classes `export-service.ts`'s `diagnosticsNote`
  // uses, and for the same reason: error-class counts mean data really may be
  // missing, unreadable, rejected, or unpriced, while provenance-class counts
  // mean nothing is missing — a response was fully priced and counted either
  // way, only its output figure's finality or its identity's reconcilability
  // is weaker than usual. Rendering both in one "data problem" block would
  // collapse that distinction right back into "something might be wrong",
  // which is false for the provenance class.
  const hasErrorDiagnostics =
    !!diagnostics &&
    (diagnostics.malformedLines > 0 ||
      diagnostics.unreadableChildren > 0 ||
      diagnostics.negativeCounters > 0 ||
      diagnostics.conflictCount > 0 ||
      diagnostics.unpricedResponses > 0 ||
      diagnostics.incompleteUsageResponses > 0)
  const hasProvenanceDiagnostics =
    !!diagnostics &&
    (diagnostics.responsesWithoutCompletionSignal > 0 || diagnostics.reducedConfidenceResponses > 0)

  const effortDist = metadata.effortDistribution
  const totalEffortTurns =
    effortDist.low + effortDist.medium + effortDist.high + effortDist.ultrathink

  const effortBars: Array<{ label: string; count: number; color: string }> = [
    { label: 'Low', count: effortDist.low, color: 'bg-green-500/60' },
    { label: 'Med', count: effortDist.medium, color: 'bg-yellow-500/60' },
    { label: 'High', count: effortDist.high, color: 'bg-orange-500/70' },
    { label: 'Ultra', count: effortDist.ultrathink, color: 'bg-red-500/70' },
  ].filter((e) => e.count > 0)

  // Reported vs. inferred effort — see `UsageProjection.recordedEffortDistribution`
  // for why these must never be merged. Keyed by whatever string the
  // transcript wrote, so shown as raw chips rather than forced into the
  // four-bucket scale the inferred bars above use.
  const recordedEffortEntries = Object.entries(
    sessionSummary?.recordedEffortDistribution ?? {}
  ).filter(([, count]) => count > 0)
  const serviceTiers = sessionSummary?.serviceTiers ?? []
  const hasEffortSection = totalEffortTurns > 0 || recordedEffortEntries.length > 0

  return (
    <Tooltip.Provider>
      <div className="flex flex-col h-full bg-background">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/50 shrink-0">
          <span className="text-xs font-semibold text-foreground">Session Details</span>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent transition-colors"
            title="Close details"
          >
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-3 py-2 min-h-0">
          {/* Session ID & slug */}
          <div className="rounded-md bg-muted/30 px-2.5 py-2 mb-3">
            <p className="text-[10px] text-muted-foreground mb-0.5">Session ID</p>
            <p className="text-[11px] font-mono text-foreground break-all">{parsedSession.id}</p>
            {parsedSession.slug && (
              <>
                <p className="text-[10px] text-muted-foreground mt-1.5 mb-0.5">Slug</p>
                <p className="text-[11px] font-mono text-foreground">{parsedSession.slug}</p>
              </>
            )}
            {parsedSession.isSubagent && (
              <span className="inline-flex items-center gap-1 mt-1.5 rounded-sm bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-400">
                <Bot className="h-2.5 w-2.5" />
                Subagent
              </span>
            )}
          </div>

          {/* Timing */}
          <SectionHeader icon={Clock} title="Timing" />
          <div className="rounded-md border border-border/40 px-2.5 py-1">
            <StatRow
              label="Started"
              value={
                metadata.firstTimestamp
                  ? format(new Date(metadata.firstTimestamp), 'MMM d, yyyy HH:mm:ss')
                  : '—'
              }
              hint="Timestamp of the first message in this session"
            />
            <StatRow
              label="Last activity"
              value={
                metadata.lastTimestamp
                  ? format(new Date(metadata.lastTimestamp), 'MMM d, yyyy HH:mm:ss')
                  : '—'
              }
              hint="Timestamp of the most recent message in this session"
            />
            <StatRow
              label="Duration"
              value={durationLabel(sessionDurationMs)}
              hint="Wall-clock time from first to last message"
            />
            {metadata.turnDurations.length > 0 && (
              <StatRow
                label="Median turn"
                hint="Middle value of all turn durations — less affected by outliers than average"
                value={durationLabel(
                  [...metadata.turnDurations].sort((a, b) => a.durationMs - b.durationMs)[
                    Math.floor(metadata.turnDurations.length / 2)
                  ]?.durationMs ?? 0
                )}
              />
            )}
          </div>

          {/* Tokens & cost */}
          <SectionHeader icon={Zap} title="Tokens & Cost" />
          <div className="rounded-md border border-border/40 px-2.5 py-1">
            <StatRow
              label="Input tokens"
              value={formatTokens(metadata.totalInputTokens)}
              hint="Fresh (uncached) tokens sent to the model this session"
            />
            <StatRow
              label="Output tokens"
              value={formatTokens(metadata.totalOutputTokens)}
              hint="Tokens generated by the model in responses"
            />
            {/*
              Scope must match the row above: `sessionSummary.thinkingTokens` is
              combined (parent + subagent), same as `metadata.totalOutputTokens`
              only when there are no subagents to add. With subagents present,
              this instead renders beside "Total output" below, where both
              figures share the combined scope — see that block.
            */}
            {!hasSubagents && !!sessionSummary?.thinkingTokens && (
              <StatRow
                label="Reported thinking"
                value={formatTokens(sessionSummary.thinkingTokens)}
                hint="A subset of output tokens the model reported spending on reasoning — already counted in Output tokens above, not additional to it."
              />
            )}
            <StatRow
              label="Total tokens"
              value={formatTokens(sessionTokens)}
              hint="Fresh input + output tokens for this session (excludes subagents). Cache read and cache created, below, are billed separately and not included in this figure."
            />
            <StatRow
              label="Cache read"
              value={formatTokens(metadata.totalCacheReadTokens)}
              hint={cacheReadHint}
            />
            <StatRow
              label="Cache created"
              value={formatTokens(metadata.totalCacheCreationTokens)}
              hint={cacheWriteHint}
            />
            {sessionOnlyCost !== undefined && (
              <StatRow
                label="Est. cost"
                value={formatCost(sessionOnlyCost)}
                hint="Estimated cost for this session only, excluding subagent spend"
              />
            )}
          </div>

          {/* Context efficiency */}
          {compactionEvents.length > 0 && (
            <>
              <SectionHeader icon={Scissors} title="Context Efficiency" />
              <div className="rounded-md border border-border/40 px-2.5 py-1">
                <StatRow
                  label="Compactions"
                  value={compactionEvents.length}
                  hint="Number of times Claude summarised the conversation to free up context window space"
                />
                <StatRow
                  label="Peak context"
                  value={formatTokens(peakContextTokens)}
                  hint="Largest context window size (tokens) recorded just before a compaction"
                />
                <StatRow
                  label="Pre-compaction context"
                  value={formatTokens(totalTokensRemoved)}
                  hint="Sum of context size recorded just before each compaction — an observed high-water mark, not a measurement of tokens actually freed (a summary is retained afterward and the summarisation call itself is billed)"
                />
                <StatRow
                  label="Hypothetical resend cost"
                  value={hypotheticalResendCost === null ? '—' : formatCost(hypotheticalResendCost)}
                  hint={
                    hypotheticalResendCost === null
                      ? `Not priced: ${primaryModel ?? 'this model'} is not a recognised model, so no rate applies`
                      : `Hypothetical: what re-sending that pre-compaction context as fresh input would have cost (@ $${pricingTable[dominantModelFamily].input}/M for ${primaryModel ?? 'this model'}). Ignores the retained summary, the summarisation call's own cost, and any later cache reuse — not a measured saving.`
                  }
                />
              </div>
              {/* Per-event timeline */}
              <div className="mt-1.5 space-y-1">
                {compactionEvents.map((evt) => {
                  const pct =
                    peakContextTokens > 0
                      ? Math.min(100, ((evt.preTokens ?? 0) / peakContextTokens) * 100)
                      : 0
                  return (
                    <div
                      key={evt.index}
                      className="rounded-md border border-border/30 bg-muted/20 px-2.5 py-1.5"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-medium text-muted-foreground">
                          Compaction #{evt.index + 1}
                          {evt.timestamp && (
                            <span className="ml-1.5 font-normal opacity-60">
                              {format(new Date(evt.timestamp), 'HH:mm:ss')}
                            </span>
                          )}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatTokens(evt.preTokens ?? 0)} ctx · {evt.turnsSinceLastCompaction}{' '}
                          turns
                        </span>
                      </div>
                      <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-amber-500/60 transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* Subagent token contribution */}
          {hasSubagents && (
            <>
              <SectionHeader icon={Bot} title="Subagents Usage" />
              <div className="rounded-md border border-border/40 px-2.5 py-1">
                <StatRow
                  label="Input tokens"
                  value={formatTokens(subagentTotals.inputTokens)}
                  hint="Fresh input tokens consumed across all subagent sessions"
                />
                <StatRow
                  label="Output tokens"
                  value={formatTokens(subagentTotals.outputTokens)}
                  hint="Output tokens generated across all subagent sessions"
                />
                <StatRow
                  label="Total tokens"
                  value={formatTokens(subagentTotals.inputTokens + subagentTotals.outputTokens)}
                  hint="Combined input + output tokens across all subagents"
                />
                <StatRow
                  label="Est. cost"
                  value={formatCost(subagentsCost)}
                  hint="Estimated total cost attributed to subagent sessions"
                />
              </div>
              <div className="rounded-md border border-primary/20 bg-primary/5 px-2.5 py-1 mt-1.5">
                <StatRow
                  label="Total input"
                  value={formatTokens(metadata.totalInputTokens + subagentTotals.inputTokens)}
                  hint="Parent session + all subagent input tokens combined"
                />
                <StatRow
                  label="Total output"
                  value={formatTokens(metadata.totalOutputTokens + subagentTotals.outputTokens)}
                  hint="Parent session + all subagent output tokens combined"
                />
                {!!sessionSummary?.thinkingTokens && (
                  <StatRow
                    label="Reported thinking"
                    value={formatTokens(sessionSummary.thinkingTokens)}
                    hint="A subset of Total output — the model's reported reasoning spend, already counted above, not additional to it. Combined across parent and all subagent responses."
                  />
                )}
                <StatRow
                  label="Total tokens"
                  value={formatTokens(
                    sessionTokens + subagentTotals.inputTokens + subagentTotals.outputTokens
                  )}
                  hint="Grand total tokens across parent session and all subagents"
                />
                {totalCost !== undefined && (
                  <StatRow
                    label="Total cost"
                    value={formatCost(totalCost)}
                    hint="Grand total cost: parent session + all subagents"
                  />
                )}
              </div>
            </>
          )}

          {/* Messages */}
          <SectionHeader icon={Layers} title="Messages" />
          <div className="rounded-md border border-border/40 px-2.5 py-1">
            <StatRow
              label="Session total"
              value={metadata.messageCount}
              hint="Total messages in this session (user + assistant), excluding subagents"
            />
            <StatRow
              label="User"
              value={metadata.userMessageCount}
              hint="Number of user-turn messages sent in this session"
            />
            <StatRow
              label="Assistant"
              value={metadata.assistantMessageCount}
              hint="Number of assistant responses generated in this session"
            />
            {hasSubagents && (
              <StatRow
                label="Subagents"
                value={subagentTotals.messageCount}
                hint="Total messages across all spawned subagent sessions"
              />
            )}
            {hasSubagents && (
              <StatRow
                label="Grand total"
                value={metadata.messageCount + subagentTotals.messageCount}
                hint="All messages combined: this session plus every subagent session"
              />
            )}
            <StatRow
              label="Compactions"
              value={metadata.compactionCount}
              hint="Number of times the conversation context was summarised to free up token space"
            />
          </div>

          {/* Models */}
          {metadata.models.length > 0 && (
            <>
              <SectionHeader icon={Cpu} title="Models" />
              <div className="space-y-1">
                {metadata.models.map((model) => {
                  const meta = getModelMeta(model)
                  return (
                    <div key={model} className="flex items-center gap-2">
                      <span
                        className={`rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${meta.badgeClass}`}
                      >
                        {meta.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground font-mono truncate">
                        {model}
                      </span>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* Service tiers: distinct values reported across this session's responses */}
          {serviceTiers.length > 0 && (
            <>
              <SectionHeader icon={Cpu} title="Service Tiers" />
              <div className="flex flex-wrap gap-1">
                {serviceTiers.map((tier) => (
                  <span
                    key={tier}
                    className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground"
                  >
                    {tier}
                  </span>
                ))}
              </div>
            </>
          )}

          {/* Effort distribution: inferred (heuristic) beside recorded (from the transcript's own `effort` field) */}
          {hasEffortSection && (
            <>
              <SectionHeader icon={Zap} title="Thinking Effort" />
              {totalEffortTurns > 0 && (
                <>
                  <p className="text-[9px] uppercase tracking-wide text-muted-foreground/70 mb-1">
                    Inferred (from output &amp; thinking length)
                  </p>
                  <div className="space-y-1">
                    {effortBars.map(({ label, count, color }) => {
                      const pct = (count / totalEffortTurns) * 100
                      return (
                        <div key={label} className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground w-8 shrink-0">
                            {label}
                          </span>
                          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full rounded-full ${color}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-muted-foreground w-6 text-right">
                            {count}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
              {recordedEffortEntries.length > 0 && (
                <div className={totalEffortTurns > 0 ? 'mt-2.5' : undefined}>
                  <p className="text-[9px] uppercase tracking-wide text-muted-foreground/70 mb-1">
                    Reported by transcript (not inferred)
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {recordedEffortEntries.map(([key, count]) => (
                      <span
                        key={key}
                        className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      >
                        {key}: {count}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/*
            Error-class diagnostics: bad input this parse could not simply
            absorb, or a response this session could not fully price/observe.
            Each count below is its own independent sentence — a session can
            trip exactly one (e.g. only a rejected negative counter, with no
            malformed lines), so no sentence may depend on another having
            rendered first.
          */}
          {hasErrorDiagnostics && diagnostics && (
            <div className="mt-4 rounded-md bg-amber-500/10 border border-amber-500/20 px-2.5 py-2 flex items-start gap-1.5">
              <AlertCircle className="h-3 w-3 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-[10px] text-muted-foreground space-y-1">
                {diagnostics.malformedLines > 0 && (
                  <p>
                    {diagnostics.malformedLines} unreadable line
                    {diagnostics.malformedLines === 1 ? '' : 's'} could not be parsed and{' '}
                    {diagnostics.malformedLines === 1 ? 'is' : 'are'} excluded from these totals.
                  </p>
                )}
                {diagnostics.unreadableChildren > 0 && (
                  <p>
                    {diagnostics.unreadableChildren} unreadable subagent file
                    {diagnostics.unreadableChildren === 1 ? '' : 's'} could not be parsed and{' '}
                    {diagnostics.unreadableChildren === 1 ? 'is' : 'are'} excluded from these
                    totals.
                  </p>
                )}
                {diagnostics.negativeCounters > 0 && (
                  <p>
                    {diagnostics.negativeCounters} usage counter
                    {diagnostics.negativeCounters === 1 ? '' : 's'} reported a negative value and{' '}
                    {diagnostics.negativeCounters === 1 ? 'was' : 'were'} treated as missing.
                  </p>
                )}
                {diagnostics.conflictCount > 0 && (
                  <p>
                    {diagnostics.conflictCount} response
                    {diagnostics.conflictCount === 1 ? '' : 's'} had repeated snapshots that
                    disagreed with each other and may be inaccurate.
                  </p>
                )}
                {diagnostics.unpricedResponses > 0 && (
                  <p>
                    {diagnostics.unpricedResponses} response
                    {diagnostics.unpricedResponses === 1 ? '' : 's'} could not be priced (unknown
                    model) and {diagnostics.unpricedResponses === 1 ? 'is' : 'are'} excluded from
                    cost totals.
                  </p>
                )}
                {diagnostics.incompleteUsageResponses > 0 && (
                  <p>
                    {diagnostics.incompleteUsageResponses} response
                    {diagnostics.incompleteUsageResponses === 1 ? '' : 's'} had usage data that was
                    unreadable or self-contradictory and{' '}
                    {diagnostics.incompleteUsageResponses === 1 ? 'is' : 'are'} only partially
                    observed.
                  </p>
                )}
              </div>
            </div>
          )}

          {/*
            Provenance-class diagnostics: nothing is missing here — every
            response below was fully priced and counted either way. Same
            vocabulary as `export-service.ts`'s `diagnosticsNote` provenance
            clause, so the export and this panel never describe the same
            count two different ways. Deliberately a separate, neutral block
            (no AlertCircle, no amber) rather than folded into the error-class
            box above — that box's styling itself would say "something is
            wrong", which is false for these two counts.
          */}
          {hasProvenanceDiagnostics && diagnostics && (
            <div className="mt-2 rounded-md bg-muted/40 border border-border/40 px-2.5 py-2 flex items-start gap-1.5">
              <Info className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
              <div className="text-[10px] text-muted-foreground space-y-1">
                {diagnostics.responsesWithoutCompletionSignal > 0 && (
                  <p>
                    {diagnostics.responsesWithoutCompletionSignal} response
                    {diagnostics.responsesWithoutCompletionSignal === 1 ? '' : 's'} report an output
                    count that is the maximum observed across snapshots, not a reported final count,
                    because no completion signal was ever seen.
                  </p>
                )}
                {diagnostics.reducedConfidenceResponses > 0 && (
                  <p>
                    {diagnostics.reducedConfidenceResponses} response
                    {diagnostics.reducedConfidenceResponses === 1 ? '' : 's'} have
                    reduced-confidence identity: no message.id was present, so identity fell back to
                    the record uuid.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Errors */}
          {metadata.errorDetails.length > 0 && (
            <>
              <SectionHeader icon={AlertCircle} title="Errors" />
              <div className="space-y-1.5">
                {metadata.errorDetails.map((err, i) => (
                  <div
                    key={i}
                    className="rounded-md bg-destructive/10 border border-destructive/20 px-2.5 py-2"
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <AlertCircle className="h-3 w-3 text-destructive shrink-0" />
                      <span className="text-[10px] font-medium text-destructive">
                        {err.classification}
                      </span>
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        turn {err.turnIndex}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">{err.message}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Subagents */}
          {subagents.length > 0 && (
            <>
              <SectionHeader icon={Bot} title={`Subagents (${subagents.length})`} />
              <div className="space-y-1.5">
                {subagents.map((sub) => (
                  <SubagentCard key={sub.agentId} subagent={sub} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </Tooltip.Provider>
  )
}
