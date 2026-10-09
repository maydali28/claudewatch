import type { ResponseTimelinePoint } from '@shared/types'

export interface TimelineDatum {
  /** Epoch ms of the response. */
  t: number
  /** Estimated cost of every response up to and including this one. */
  cumulativeCost: number
  /** Set on parent responses only. */
  parentContext?: number
  /** Set on sub-agent responses only. */
  subagentContext?: number
  model?: string
  agentId?: string
}

export interface TimelineSeries {
  data: TimelineDatum[]
  peakContext: number
  totalCost: number
  /** Responses whose model could not be priced; they add nothing to the cost line. */
  unpricedResponses: number
  subagentResponses: number
}

/** The Timeline tab's series, from the full parse's `responseTimeline` (already sorted). */
export function buildTimelineSeries(points: readonly ResponseTimelinePoint[]): TimelineSeries {
  const data: TimelineDatum[] = []
  let cumulativeCost = 0
  let peakContext = 0
  let unpricedResponses = 0
  let subagentResponses = 0
  for (const p of points) {
    const t = new Date(p.timestamp).getTime()
    if (!Number.isFinite(t)) continue
    if (p.costUsd === null) unpricedResponses++
    else cumulativeCost += p.costUsd
    if (p.contextTokens > peakContext) peakContext = p.contextTokens
    const datum: TimelineDatum = { t, cumulativeCost }
    if (p.source === 'subagent') {
      subagentResponses++
      datum.subagentContext = p.contextTokens
      if (p.agentId) datum.agentId = p.agentId
    } else {
      datum.parentContext = p.contextTokens
    }
    if (p.model) datum.model = p.model
    data.push(datum)
  }
  return { data, peakContext, totalCost: cumulativeCost, unpricedResponses, subagentResponses }
}
