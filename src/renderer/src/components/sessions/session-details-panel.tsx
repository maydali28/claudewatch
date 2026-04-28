import React from 'react'
import { X, Clock, Zap, AlertCircle, Layers, Cpu, Bot, Info, Scissors } from 'lucide-react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { format, formatDuration, intervalToDuration } from 'date-fns'
import { useSessionsStore } from '@renderer/store/sessions.store'
import { formatTokens, formatCost } from '@shared/utils'
import { getModelMeta } from '@renderer/lib/model-meta'
import { ANTHROPIC_PRICING } from '@shared/constants/pricing'
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
  const hasSubagents = subagentTotals.inputTokens + subagentTotals.outputTokens > 0

  const sessionSummary = projects.flatMap((p) => p.sessions).find((s) => s.id === parsedSession.id)

  // estimatedCost comes from SessionSummary (includes subagent rollup from parseSessionMetadata)
  const totalCost = sessionSummary?.estimatedCost
  const subagents = sessionSummary?.subagents ?? []
  // Derive session-only cost: total minus subagent costs
  const subagentsCost = subagents.reduce((s, a) => s + a.estimatedCost, 0)
  const sessionOnlyCost = totalCost !== undefined ? totalCost - subagentsCost : undefined

  const sessionDurationMs =
    metadata.firstTimestamp && metadata.lastTimestamp
      ? new Date(metadata.lastTimestamp).getTime() - new Date(metadata.firstTimestamp).getTime()
      : 0

  // ── Context efficiency (compaction) ──────────────────────────────────────────
  const compactionEvents = metadata.compactionEvents ?? []
  const totalTokensRemoved = compactionEvents.reduce((sum, e) => sum + (e.preTokens ?? 0), 0)
  const peakContextTokens =
    compactionEvents.length > 0 ? Math.max(...compactionEvents.map((e) => e.preTokens ?? 0)) : 0
  const primaryModel = sessionSummary?.primaryModel ?? metadata.models[0]
  const inputRatePerMillion = ANTHROPIC_PRICING[getModelFamily(primaryModel)]?.input ?? 3.0
  const estimatedCostAvoided = (totalTokensRemoved / 1_000_000) * inputRatePerMillion

  const effortDist = metadata.effortDistribution
  const totalEffortTurns =
    effortDist.low + effortDist.medium + effortDist.high + effortDist.ultrathink

  const effortBars: Array<{ label: string; count: number; color: string }> = [
    { label: 'Low', count: effortDist.low, color: 'bg-green-500/60' },
    { label: 'Med', count: effortDist.medium, color: 'bg-yellow-500/60' },
    { label: 'High', count: effortDist.high, color: 'bg-orange-500/70' },
    { label: 'Ultra', count: effortDist.ultrathink, color: 'bg-red-500/70' },
  ].filter((e) => e.count > 0)

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
            <StatRow
              label="Total tokens"
              value={formatTokens(sessionTokens)}
              hint="Input + output tokens for this session (excludes subagents)"
            />
            <StatRow
              label="Cache read"
              value={formatTokens(metadata.totalCacheReadTokens)}
              hint="Tokens served from Anthropic's prompt cache — billed at ~10% of normal input rate"
            />
            <StatRow
              label="Cache created"
              value={formatTokens(metadata.totalCacheCreationTokens)}
              hint="Tokens written into the prompt cache — billed at ~125% of normal input rate, amortised over future reads"
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
                  label="Tokens removed"
                  value={formatTokens(totalTokensRemoved)}
                  hint="Sum of context tokens cleared across all compaction events — these were re-summarised rather than re-sent"
                />
                <StatRow
                  label="Cost avoided"
                  value={formatCost(estimatedCostAvoided)}
                  hint={`Estimated savings from not re-sending those tokens as fresh input (@ $${inputRatePerMillion}/M for ${primaryModel ?? 'this model'})`}
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

          {/* Effort distribution */}
          {totalEffortTurns > 0 && (
            <>
              <SectionHeader icon={Zap} title="Thinking Effort" />
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
