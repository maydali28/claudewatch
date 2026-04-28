import React, { useState } from 'react'
import { Brain, Clock, GitBranch, Bot } from 'lucide-react'
import type {
  ParsedRecord,
  ContentBlock,
  ToolResultEntry,
  TurnDuration,
  EffortLevel,
  SubagentSummary,
} from '@shared/types'
import ThinkingBlock from '@renderer/components/shared/thinking-block'
import ToolResultBlock from '@renderer/components/shared/tool-result-block'
import MarkdownRenderer from '@renderer/components/shared/markdown-renderer'
import { parseUserMessage, type ParsedContextTag } from './user-message-parser'
import { cn } from '@renderer/lib/cn'
import { getModelMeta } from '@renderer/lib/model-meta'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@renderer/components/ui/tooltip'

interface MessageBubbleProps {
  record: ParsedRecord
  toolResultMap: Record<string, ToolResultEntry>
  searchQuery?: string
  turnDuration?: TurnDuration
  subagents?: SubagentSummary[]
}

function CompactionBoundary({ preTokens }: { preTokens?: number }): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 h-px bg-border/50" />
      <span className="text-[10px] text-muted-foreground/60 shrink-0">
        — Context compacted {preTokens ? `(${(preTokens / 1000).toFixed(0)}K tokens removed)` : ''}{' '}
        —
      </span>
      <div className="flex-1 h-px bg-border/50" />
    </div>
  )
}

// ─── Context tag pill ─────────────────────────────────────────────────────────

const KIND_STYLES: Record<ParsedContextTag['kind'], string> = {
  file: 'border-sky-500/40 bg-sky-500/10 text-sky-400',
  selection: 'border-violet-500/40 bg-violet-500/10 text-violet-400',
  reminder: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
  command: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
  generic: 'border-border/40 bg-muted/30 text-muted-foreground',
}

const KIND_ICON: Record<ParsedContextTag['kind'], string> = {
  file: '📄',
  selection: '✂️',
  reminder: '📌',
  command: '⚡',
  generic: '🏷️',
}

function basename(path: string): string {
  return path.split('/').pop() ?? path
}

function ContextTagPill({ ctag }: { ctag: ParsedContextTag }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const styles = KIND_STYLES[ctag.kind]
  const icon = KIND_ICON[ctag.kind]
  const hasContent = ctag.content.length > 0
  const displayName = ctag.filePath ? basename(ctag.filePath) : ctag.label

  return (
    <div className={cn('rounded-lg border text-[11px] overflow-hidden', styles)}>
      <button
        className="flex w-full items-center gap-1.5 px-2.5 py-1 text-left hover:opacity-80 transition-opacity"
        onClick={() => hasContent && setOpen((v) => !v)}
      >
        <span className="text-[10px]">{icon}</span>
        <span className="font-medium">{ctag.label}</span>
        {ctag.filePath && (
          <span
            className="ml-1 font-mono font-normal opacity-75 truncate max-w-[30ch]"
            title={ctag.filePath}
          >
            {displayName}
          </span>
        )}
        {hasContent && <span className="ml-auto opacity-50 shrink-0">{open ? '▴' : '▾'}</span>}
      </button>

      {open && hasContent && (
        <div className="border-t border-current/20 px-2.5 py-2 space-y-1.5">
          {ctag.filePath && (
            <div className="font-mono text-[10px] opacity-60 break-all">{ctag.filePath}</div>
          )}
          {/* Non-path content (e.g. selection text, reminder body) */}
          {(ctag.kind !== 'file' || ctag.content !== ctag.filePath) && (
            <pre className="whitespace-pre-wrap break-words font-mono text-[10px] opacity-80 max-h-48 overflow-y-auto">
              {ctag.content}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Block renderer ───────────────────────────────────────────────────────────

function renderBlock(
  block: ContentBlock,
  toolResultMap: Record<string, ToolResultEntry>,
  searchQuery: string,
  idx: number
): React.ReactNode {
  switch (block.type) {
    case 'text':
      return (
        <MarkdownRenderer
          key={idx}
          content={
            searchQuery
              ? block.text.replace(new RegExp(searchQuery, 'gi'), (m) => `**${m}**`)
              : block.text
          }
          className="text-sm"
        />
      )
    case 'thinking':
      return <ThinkingBlock key={idx} thinking={block.thinking} className="mt-2" />
    case 'tool_use': {
      const result = toolResultMap[block.id]
      return (
        <ToolResultBlock
          key={idx}
          toolName={block.toolName}
          input={block.input}
          result={result?.content}
          isError={result?.isError}
          className="mt-2"
        />
      )
    }
    case 'tool_result':
      return null
    default:
      return null
  }
}

// ─── Turn metrics helpers ─────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rem = Math.round(s % 60)
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`
}

function classifyEffortFromUsage(
  outputTokens: number,
  thinkingChars: number,
  stopReason?: string
): EffortLevel {
  if (thinkingChars > 5000 || outputTokens > 5000 || stopReason === 'max_tokens')
    return 'ultrathink'
  if (thinkingChars > 1000 || outputTokens > 2000) return 'high'
  if (thinkingChars > 0 || outputTokens > 500) return 'medium'
  return 'low'
}

const EFFORT_CONFIG: Record<EffortLevel, { label: string; badgeClass: string }> = {
  low: { label: 'Low', badgeClass: 'bg-emerald-500/10 text-emerald-500' },
  medium: { label: 'Medium', badgeClass: 'bg-blue-500/10 text-blue-500' },
  high: { label: 'High', badgeClass: 'bg-yellow-500/10 text-yellow-500' },
  ultrathink: { label: 'Ultrathink', badgeClass: 'bg-red-500/10 text-red-500' },
}

function durationBadgeClass(ms: number): string {
  if (ms < 5000) return 'bg-emerald-500/10 text-emerald-500'
  if (ms < 60000) return 'bg-yellow-500/10 text-yellow-500'
  return 'bg-red-500/10 text-red-500'
}

function subagentDurationMs(sub: SubagentSummary): number {
  if (!sub.firstTimestamp || !sub.lastTimestamp) return 0
  return new Date(sub.lastTimestamp).getTime() - new Date(sub.firstTimestamp).getTime()
}

function TurnMetrics({
  record,
  turnDuration,
  subagents = [],
}: {
  record: ParsedRecord
  turnDuration?: TurnDuration
  subagents?: SubagentSummary[]
}): React.JSX.Element | null {
  const outputTokens = record.usage?.outputTokens ?? 0
  const thinkingChars = record.contentBlocks
    .filter((b) => b.type === 'thinking')
    .reduce((s, b) => s + (b.type === 'thinking' ? b.thinking.length : 0), 0)

  const effort = classifyEffortFromUsage(outputTokens, thinkingChars, record.stopReason)
  const { label, badgeClass } = EFFORT_CONFIG[effort]

  const parallelCount = record.contentBlocks.filter((b) => b.type === 'tool_use').length

  // Match subagents that ran during this turn: the subagent starts after the previous
  // user message and finishes before the next user message (tool_result carrier).
  // We use lastTimestamp <= turnEnd + durationMs because the agent runs after the
  // assistant message that launched it (firstTimestamp ≈ assistantTimestamp + few ms).
  const turnStart = turnDuration?.prevTimestamp
    ? new Date(turnDuration.prevTimestamp).getTime()
    : null
  const turnEnd = record.timestamp
    ? new Date(record.timestamp).getTime() + (turnDuration?.durationMs ?? 0)
    : null
  const turnSubagents = subagents.filter((sub) => {
    if (!sub.firstTimestamp || !sub.lastTimestamp || turnStart === null || turnEnd === null)
      return false
    const start = new Date(sub.firstTimestamp).getTime()
    const end = new Date(sub.lastTimestamp).getTime()
    return start >= turnStart && end <= turnEnd
  })
  const agentTotalMs = turnSubagents.reduce((s, sub) => s + subagentDurationMs(sub), 0)

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-center gap-1.5">
        {turnDuration && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-[10px] font-medium tabular-nums',
                  durationBadgeClass(turnDuration.durationMs)
                )}
              >
                <Clock className="h-2.5 w-2.5 shrink-0" />
                {formatDuration(turnDuration.durationMs)}
                {agentTotalMs > 0 && (
                  <span className="opacity-60">
                    {' '}
                    (<Bot className="inline h-2 w-2 mb-0.5" />
                    {formatDuration(agentTotalMs)})
                  </span>
                )}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[10px]">
              {agentTotalMs > 0 ? (
                <div className="space-y-0.5">
                  <div>Total: {formatDuration(turnDuration.durationMs)}</div>
                  <div className="text-muted-foreground">Agent: {formatDuration(agentTotalMs)}</div>
                  <div className="text-muted-foreground">
                    Model: {formatDuration(Math.max(0, turnDuration.durationMs - agentTotalMs))}
                  </div>
                </div>
              ) : (
                'Response time'
              )}
            </TooltipContent>
          </Tooltip>
        )}
        {parallelCount > 1 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-[10px] font-medium bg-cyan-500/10 text-cyan-500">
                <GitBranch className="h-2.5 w-2.5 shrink-0" />
                {parallelCount}×
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[10px]">
              {parallelCount} tools called in parallel
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-[10px] font-medium',
                badgeClass
              )}
            >
              <Brain className="h-2.5 w-2.5 shrink-0" />
              {label}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-[10px]">
            Effort: {label} · {outputTokens.toLocaleString()} output tokens
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MessageBubble({
  record,
  toolResultMap,
  searchQuery = '',
  turnDuration,
  subagents,
}: MessageBubbleProps): React.JSX.Element {
  if (record.isCompactionBoundary) {
    return <CompactionBoundary preTokens={record.compactionPreTokens} />
  }

  const role = record.role

  if (role === 'user') {
    const textBlocks = record.contentBlocks.filter((b) => b.type === 'text')
    const rawText = textBlocks
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('\n')
      .trim()
    if (!rawText) return <></>

    const { mainText, contextTags } = parseUserMessage(rawText)

    // If parsing stripped everything into tags with no remaining text, and there
    // are no tags either, nothing to show.
    if (!mainText && contextTags.length === 0) return <></>

    return (
      <div className="flex flex-col items-end px-4 py-1 gap-1.5">
        {/* Context tag pills — rendered above the bubble */}
        {contextTags.length > 0 && (
          <div className="flex flex-col gap-1 w-full max-w-[80%] items-end">
            {contextTags.map((ctag, i) => (
              <ContextTagPill key={i} ctag={ctag} />
            ))}
          </div>
        )}

        {/* Main message bubble — only when there is actual text */}
        {mainText && (
          <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-blue-600 px-4 py-2.5 text-sm text-white shadow-sm">
            <MarkdownRenderer
              content={
                searchQuery
                  ? mainText.replace(
                      new RegExp(searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
                      (m) => `**${m}**`
                    )
                  : mainText
              }
              variant="inverted"
            />
          </div>
        )}
      </div>
    )
  }

  if (role === 'assistant') {
    const hasVisibleBlocks = record.contentBlocks.some(
      (b) => b.type === 'text' || b.type === 'thinking' || b.type === 'tool_use'
    )
    if (!hasVisibleBlocks) return <></>

    return (
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          {(() => {
            const meta = getModelMeta(record.model)
            return (
              <span className={`rounded-sm px-1 py-0.5 text-[10px] font-medium ${meta.badgeClass}`}>
                {meta.label}
              </span>
            )
          })()}
          <div className="flex items-center gap-1.5 ml-auto">
            {record.usage && record.usage.outputTokens > 0 && (
              <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                {record.usage.outputTokens.toLocaleString()} tokens
              </span>
            )}
            <TurnMetrics record={record} turnDuration={turnDuration} subagents={subagents} />
          </div>
        </div>
        <div className="max-w-[85%] space-y-1">
          {record.contentBlocks.map((block, idx) =>
            renderBlock(block, toolResultMap, searchQuery, idx)
          )}
        </div>
      </div>
    )
  }

  if (role === 'system') {
    const text = record.contentBlocks
      .filter((b) => b.type === 'text')
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('\n')
      .trim()
    if (!text) return <></>
    return (
      <div className="flex justify-center px-4 py-1">
        <div className="max-w-[80%] rounded-md border border-border/30 bg-muted/20 px-3 py-1.5 text-[10px] text-muted-foreground text-center">
          {text.slice(0, 200)}
          {text.length > 200 ? '…' : ''}
        </div>
      </div>
    )
  }

  return <></>
}
