import React from 'react'
import { LineChart as LineChartIcon } from 'lucide-react'
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
import { EmptyState } from '@renderer/components/shared/empty-state'
import type { ResponseTimelinePoint } from '@shared/types'
import { InsightSection, StatTiles } from './insight-section'
import { buildTimelineSeries, type TimelineDatum } from './timeline-series'

// Validated as a two-slot categorical pair in light and dark mode
// (dataviz validate_palette.js): parent blue, sub-agent amber.
const PARENT_COLOR = '#3b82f6'
const SUBAGENT_COLOR = '#d97706'
const CHART_HEIGHT = 150
const AXIS_TICK = { fontSize: 9, fill: 'hsl(var(--muted-foreground))' }

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
function SmallDot(props: { cx?: number; cy?: number }): React.JSX.Element | null {
  if (props.cx === undefined || props.cy === undefined) return null
  return <circle cx={props.cx} cy={props.cy} r={2} fill={SUBAGENT_COLOR} fillOpacity={0.7} />
}

export function SessionTimelineTab({
  timeline,
}: {
  timeline: ResponseTimelinePoint[]
}): React.JSX.Element {
  const series = React.useMemo(() => buildTimelineSeries(timeline), [timeline])

  if (series.data.length === 0) {
    return (
      <EmptyState
        icon={LineChartIcon}
        title="No dated responses"
        description="This session has no API responses with a timestamp"
      />
    )
  }

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
    <div>
      <StatTiles
        tiles={[
          { label: 'Responses', value: series.data.length },
          { label: 'Peak context', value: formatTokens(series.peakContext) },
          { label: 'Est. cost', value: formatCost(series.totalCost) },
        ]}
      />

      <InsightSection
        title="Cumulative cost"
        note={
          series.unpricedResponses > 0
            ? `Parent and sub-agents. ${series.unpricedResponses} unpriced response${series.unpricedResponses === 1 ? '' : 's'} add nothing.`
            : 'Parent and sub-agents'
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
              width={46}
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
        note="Prompt size of each request: fresh input + cache read + cache write"
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
              width={46}
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
