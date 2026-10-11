import { LINT_RULE_MAP } from '@shared/constants/lint-rules'
import type { LintResult, LintSeverity } from '@shared/types'

export type SeverityFilter = LintSeverity | 'all'

/** The areas results are grouped by, most urgent first. */
export const HEALTH_AREAS = [
  'Secrets',
  'Sessions',
  'Config',
  'CLAUDE.md',
  'Rules',
  'Skills',
  'Cross-cutting',
] as const

const BY_PREFIX: Record<string, string> = {
  SEC: 'Secrets',
  SES: 'Sessions',
  CFG: 'Config',
  CMD: 'CLAUDE.md',
  RUL: 'Rules',
  SKL: 'Skills',
  XCT: 'Cross-cutting',
}

export function areaOf(checkId: string): string {
  return LINT_RULE_MAP.get(checkId as never)?.category ?? BY_PREFIX[checkId.slice(0, 3)] ?? 'Other'
}

const SEVERITY_RANK: Record<LintSeverity, number> = { error: 0, warning: 1, info: 2 }

/** Results matching the severity chip and the filter text (check id, message, area or path). */
export function filterHealthResults(
  results: LintResult[],
  severity: SeverityFilter,
  search: string
): LintResult[] {
  const q = search.trim().toLowerCase()
  return results.filter((r) => {
    if (severity !== 'all' && r.severity !== severity) return false
    if (!q) return true
    return [r.checkId, r.message, areaOf(r.checkId), r.displayPath ?? '']
      .join(' ')
      .toLowerCase()
      .includes(q)
  })
}

export interface HealthGroup {
  area: string
  results: LintResult[]
}

/** Grouped by area in `HEALTH_AREAS` order, errors first inside each group. */
export function groupByArea(results: LintResult[]): HealthGroup[] {
  const map = new Map<string, LintResult[]>()
  for (const r of results) {
    const area = areaOf(r.checkId)
    map.set(area, [...(map.get(area) ?? []), r])
  }
  const order = (a: string): number => {
    const i = (HEALTH_AREAS as readonly string[]).indexOf(a)
    return i === -1 ? HEALTH_AREAS.length : i
  }
  return [...map.entries()]
    .sort(([a], [b]) => order(a) - order(b))
    .map(([area, rs]) => ({
      area,
      results: [...rs].sort((x, y) => SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity]),
    }))
}

export function countBySeverity(results: LintResult[]): Record<SeverityFilter, number> {
  const counts = { all: results.length, error: 0, warning: 0, info: 0 }
  for (const r of results) counts[r.severity]++
  return counts
}

/** One word per colour band of the score, so the word never says better than the colour. */
export function scoreLabel(score: number): { pct: number; label: string; tone: LintSeverity } {
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100)
  if (pct >= 80) return { pct, label: 'Good', tone: 'info' }
  if (pct >= 50) return { pct, label: 'Fair', tone: 'warning' }
  return { pct, label: 'Poor', tone: 'error' }
}
