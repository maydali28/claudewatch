import React from 'react'
import {
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { format } from 'date-fns'
import { formatCost, formatTokens } from '@shared/utils'
import type { ResponseTimelinePoint } from '@shared/types'
import { InsightSection } from './insight-section'
import { buildTimelineSeries, type TimelineDatum } from './timeline-series'

// Validated as a two-slot categorical pair in light and dark mode
// (dataviz validate_palette.js): parent blue, sub-agent amber.
const PARENT_COLOR = '#3b82f6'
const SUBAGENT_COLOR = '#d97706'
const CHART_HEIGHT = 220
const AXIS_TICK = { fontSize: 10, fill: 'hsl(var(--muted-foreground))' }

function LegendDot({ color, label }: { color: string; label: string }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="block h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  )
}

function TimelineTooltip({
  active,
  payload,
  timeFormat,
  show,
}: {
  active?: boolean
  payload?: Array<{ payload: TimelineDatum }>
  timeFormat: string
  show: 'cost' | 'context'
}): React.JSX.Element | null {
  const d = payload?.[0]?.payload
  if (!active || !d) return null
  const context = d.parentContext ?? d.subagentContext
  return (
    <div className="rounded-md border border-border/50 bg-popover px-2 py-1.5 text-[10px] text-popover-foreground shadow-md">
      <p className="text-muted-foreground">{format(new Date(d.t), timeFormat)}</p>
      {show === 'cost' ? (
        <p className="font-medium">{formatCost(d.cumulativeCost)} so far</p>
      ) : (
        <p className="font-medium">{formatTokens(context ?? 0)} context</p>
      )}
      <p className="text-muted-foreground">
        {d.subagentContext !== undefined ? `Sub-agent ${d.agentId ?? ''}` : 'Parent'}
        {d.model ? ` · ${d.model}` : ''}
      </p>
    </div>
  )
}

// Hundreds of sub-agent responses share a few minutes; Recharts' default
// marker merges them into one blob.
function SmallDot(props: {
  cx?: number
  cy?: number
  payload?: TimelineDatum
}): React.JSX.Element | null {
  // Recharts calls the shape for every row, parent responses included, and
  // pins a row with no value to the top edge.
  if (props.payload?.subagentContext === undefined) return null
  if (!Number.isFinite(props.cx) || !Number.isFinite(props.cy)) return null
  return <circle cx={props.cx} cy={props.cy} r={2} fill={SUBAGENT_COLOR} fillOpacity={0.7} />
}

/** Cumulative cost and context per response, side by side. */
export function SessionActivityCharts({
  timeline,
}: {
  timeline: ResponseTimelinePoint[]
}): React.JSX.Element | null {
  const series = React.useMemo(() => buildTimelineSeries(timeline), [timeline])

  if (series.data.length === 0) return null

  const first = series.data[0].t
  const last = series.data[series.data.length - 1].t
  const multiDay = new Date(first).toDateString() !== new Date(last).toDateString()
  const tickFormat = multiDay ? 'MMM d HH:mm' : 'HH:mm'
  const timeFormat = 'MMM d, HH:mm:ss'
  const xAxis = (
    <XAxis
      dataKey="t"
      type="number"
      scale="time"
      domain={[first, last === first ? first + 60_000 : last]}
      tickFormatter={(v: number) => format(new Date(v), tickFormat)}
      tick={AXIS_TICK}
      tickLine={false}
      axisLine={false}
      minTickGap={24}
    />
  )
  const grid = <CartesianGrid vertical={false} strokeDasharray="2 4" className="stroke-border/50" />

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <InsightSection
        title="Cumulative cost"
        note={
          series.unpricedResponses > 0
            ? `${formatCost(series.totalCost)} over ${series.data.length.toLocaleString()} responses, parent and sub-agents. ${series.unpricedResponses} unpriced response${series.unpricedResponses === 1 ? '' : 's'} add nothing.`
            : `${formatCost(series.totalCost)} over ${series.data.length.toLocaleString()} responses, parent and sub-agents`
        }
      >
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <LineChart data={series.data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            {grid}
            {xAxis}
            <YAxis
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={(v: number) => formatCost(v)}
            />
            <Tooltip
              content={<TimelineTooltip timeFormat={timeFormat} show="cost" />}
              cursor={{ strokeDasharray: '2 2' }}
            />
            <Line
              type="stepAfter"
              dataKey="cumulativeCost"
              stroke={PARENT_COLOR}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </InsightSection>

      <InsightSection
        title="Context per response"
        note={`Prompt size of each request: fresh input + cache read + cache write. Peak ${formatTokens(series.peakContext)}.`}
      >
        <div className="mb-1 flex gap-3 text-[10px] text-muted-foreground">
          <LegendDot color={PARENT_COLOR} label="Session" />
          {series.subagentResponses > 0 && <LegendDot color={SUBAGENT_COLOR} label="Sub-agents" />}
        </div>
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <ComposedChart data={series.data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            {grid}
            {xAxis}
            <YAxis
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={(v: number) => formatTokens(v)}
            />
            <Tooltip
              content={<TimelineTooltip timeFormat={timeFormat} show="context" />}
              cursor={{ strokeDasharray: '2 2' }}
            />
            <Line
              type="linear"
              dataKey="parentContext"
              stroke={PARENT_COLOR}
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
            {series.subagentResponses > 0 && (
              <Scatter
                dataKey="subagentContext"
                fill={SUBAGENT_COLOR}
                shape={SmallDot}
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </InsightSection>
    </div>
  )
}
