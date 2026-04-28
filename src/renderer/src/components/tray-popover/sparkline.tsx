import React from 'react'
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts'
import { formatTokens } from '@shared/utils/format-tokens'

interface SparklinePoint {
  date: string
  cost: number
  tokens: number
}

interface SparklineProps {
  data: SparklinePoint[]
}

function formatDateLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  if (!y || !m || !d) return dateKey
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ value: number; payload: SparklinePoint }>
}): React.JSX.Element | null {
  if (!active || !payload?.length) return null
  const point = payload[0].payload
  return (
    <div className="bg-popover border border-border rounded px-2 py-1 text-[10px] shadow-md">
      <div className="text-muted-foreground">{formatDateLabel(point.date)}</div>
      <div className="font-semibold text-foreground tabular-nums">
        {formatTokens(point.tokens)} tokens
      </div>
    </div>
  )
}

export function Sparkline({ data }: SparklineProps): React.JSX.Element {
  if (data.length === 0) {
    return (
      <div className="h-12 flex items-center justify-center text-[10px] text-muted-foreground">
        No data
      </div>
    )
  }

  return (
    <div className="h-12 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="tray-sparkline-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
              <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'hsl(var(--border))' }} />
          <Area
            type="monotone"
            dataKey="tokens"
            stroke="hsl(var(--primary))"
            strokeWidth={1.75}
            fill="url(#tray-sparkline-grad)"
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0, fill: 'hsl(var(--primary))' }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
