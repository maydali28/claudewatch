import React from 'react'
import { formatCost, formatTokens } from '@shared/utils'
import { getModelMeta } from '@renderer/lib/model-meta'
import type { ModelEfficiencyRow } from '@shared/types'

type SortKey = keyof Pick<
  ModelEfficiencyRow,
  'turnCount' | 'totalOutputTokens' | 'avgOutputPerTurn' | 'costPerTurn' | 'percentOfTotalCost'
>

interface Props {
  data: ModelEfficiencyRow[]
}

export function ModelEfficiencyTable({ data }: Props): React.JSX.Element {
  const [sortKey, setSortKey] = React.useState<SortKey>('percentOfTotalCost')
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('desc')

  function handleSort(key: SortKey): void {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sorted = [...data].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    return (a[sortKey] - b[sortKey]) * dir
  })

  const cols: { key: SortKey; label: string }[] = [
    { key: 'turnCount', label: 'Turns' },
    { key: 'totalOutputTokens', label: 'Output Tokens' },
    { key: 'avgOutputPerTurn', label: 'Avg/Turn' },
    { key: 'costPerTurn', label: 'Cost/Turn' },
    { key: 'percentOfTotalCost', label: '% Cost' },
  ]

  if (data.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">No model data</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b">
            <th className="pb-1 text-left font-medium text-muted-foreground">Model</th>
            {cols.map((c) => (
              <th
                key={c.key}
                onClick={() => handleSort(c.key)}
                className="cursor-pointer pb-1 text-right font-medium text-muted-foreground hover:text-foreground"
              >
                {c.label} {sortKey === c.key ? (sortDir === 'desc' ? '↓' : '↑') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const meta = getModelMeta(row.model)
            return (
              <tr key={row.id} className="border-b last:border-0 hover:bg-muted/50">
                <td className="py-1 pr-2">
                  <span className={`rounded-sm px-1 py-0.5 font-medium ${meta.badgeClass}`}>
                    {meta.label}
                  </span>
                </td>
                <td className="py-1 text-right">{row.turnCount}</td>
                <td className="py-1 text-right">{formatTokens(row.totalOutputTokens)}</td>
                <td className="py-1 text-right">
                  {formatTokens(Math.round(row.avgOutputPerTurn))}
                </td>
                <td className="py-1 text-right">{formatCost(row.costPerTurn)}</td>
                <td className="py-1 text-right">{row.percentOfTotalCost.toFixed(1)}%</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
