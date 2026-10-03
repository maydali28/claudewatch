import type { RawRecord, SubagentSummary } from '@shared/types/session'
import { compareTimestampsAscending } from '@shared/utils/date-ranges'
import { getRawBlocks } from './parser-helpers'

// A sub-agent's own transcript does not say how long it ran or whether it has
// finished; the parent transcript does. A foreground agent ends with the
// parent's Agent tool result (`toolUseResult.totalDurationMs`, `status:
// 'completed'`). A background agent's tool result arrives at once
// (`status: 'async_launched'`), and it ends with a task notification instead:
//
//   <task-notification><task-id>{agentId}</task-id>…<status>completed</status>
//   …<usage>…<duration_ms>187978</duration_ms></usage></task-notification>
//
// A resumed agent notifies again, so the latest notification wins.

interface AgentStop {
  durationMs?: number
  stoppedAt?: string
}

export interface AgentResultCollector {
  add(raw: RawRecord): void
  /** Fill in each summary's duration and stop time from what the parent recorded. */
  apply(summaries: SubagentSummary[]): void
}

const TASK_ID = /<task-id>([^<]+)<\/task-id>/
const STATUS = /<status>([^<]+)<\/status>/
const DURATION = /<duration_ms>(\d+)<\/duration_ms>/

function laterStop(current: AgentStop | undefined, next: AgentStop): AgentStop {
  if (!current?.stoppedAt || !next.stoppedAt) return next
  return compareTimestampsAscending(next.stoppedAt, current.stoppedAt) >= 0 ? next : current
}

export function createAgentResultCollector(): AgentResultCollector {
  const byAgentId = new Map<string, AgentStop>()
  // Every tool result the parent holds, by tool_use id: a foreground agent that
  // errored or was interrupted has one without `totalDurationMs`.
  const resultAtByToolUseId = new Map<string, string>()

  return {
    add(raw) {
      if (raw.type !== 'user') return
      const result = raw.toolUseResult
      if (result && typeof result === 'object' && typeof result.agentId === 'string') {
        if (typeof result.totalDurationMs === 'number' && result.totalDurationMs >= 0) {
          byAgentId.set(
            result.agentId,
            laterStop(byAgentId.get(result.agentId), {
              durationMs: result.totalDurationMs,
              stoppedAt: raw.timestamp,
            })
          )
        }
      }
      for (const block of getRawBlocks(raw)) {
        if (block.type === 'tool_result' && block.tool_use_id && raw.timestamp) {
          resultAtByToolUseId.set(block.tool_use_id, raw.timestamp)
        }
        if (block.type !== 'text' || !block.text?.includes('<task-notification>')) continue
        const agentId = block.text.match(TASK_ID)?.[1]
        const status = block.text.match(STATUS)?.[1]
        if (!agentId || !status || status === 'running') continue
        const duration = block.text.match(DURATION)?.[1]
        byAgentId.set(
          agentId,
          laterStop(byAgentId.get(agentId), {
            durationMs: duration ? Number(duration) : undefined,
            stoppedAt: raw.timestamp,
          })
        )
      }
    },

    apply(summaries) {
      for (const sub of summaries) {
        const stop = byAgentId.get(sub.agentId)
        if (stop?.durationMs !== undefined) {
          sub.durationMs = stop.durationMs
          sub.durationSource = 'reported'
        } else if (sub.firstTimestamp && sub.lastTimestamp) {
          const span =
            new Date(sub.lastTimestamp).getTime() - new Date(sub.firstTimestamp).getTime()
          if (Number.isFinite(span) && span >= 0) {
            sub.durationMs = span
            sub.durationSource = 'span'
          }
        }
        // A background agent's tool result is its launch, not its end.
        const foregroundResultAt =
          !sub.isBackground && sub.toolUseId ? resultAtByToolUseId.get(sub.toolUseId) : undefined
        const stoppedAt = stop?.stoppedAt ?? foregroundResultAt
        if (stoppedAt) sub.stoppedAt = stoppedAt
      }
    },
  }
}
