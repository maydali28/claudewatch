import React from 'react'

export function InsightSection({
  title,
  note,
  children,
}: {
  title: string
  note?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="mt-3 first:mt-1">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {note && <p className="mt-0.5 text-[10px] text-muted-foreground/70">{note}</p>}
      <div className="mt-1.5">{children}</div>
    </section>
  )
}

export function StatTiles({
  tiles,
}: {
  tiles: Array<{ label: string; value: React.ReactNode }>
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-md bg-muted/40 px-2 py-1.5">
          <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{t.label}</p>
          <p className="text-xs font-semibold tabular-nums text-foreground">{t.value}</p>
        </div>
      ))}
    </div>
  )
}

export function formatChars(chars: number): string {
  if (chars < 1000) return `${chars} ch`
  if (chars < 1_000_000) return `${(chars / 1000).toFixed(chars < 10_000 ? 1 : 0)}k ch`
  return `${(chars / 1_000_000).toFixed(1)}M ch`
}
