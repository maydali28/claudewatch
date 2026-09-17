import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ANTHROPIC_PRICING } from '@shared/constants/pricing'
import { toDateKey } from '@shared/utils/date-ranges'
import { getProjectsDirPath } from '@main/lib/claude-paths'
import { ingestFile } from './ledger'

// See metadata-parser.test.ts for why this mock exists (vitest's `forks` pool
// makes `@main/lib/logger`'s import-time electron-log init throw). Required
// here too since this file imports metadata-parser.ts.
vi.mock('@main/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

import { parseSessionMetadata } from '@main/services/parsers/metadata-parser'
import { computeAnalytics } from '@main/services/analytics-engine'
import type { Project } from '@shared/types/project'
import type { SessionSummary } from '@shared/types/session'
import type { DateRange } from '@shared/types/analytics'

/**
 * Checks the date-scoped analytics against the transcripts themselves.
 *
 * The other verification file proves the ledger and the session summaries agree
 * in total. This one proves the *range* arithmetic: what the dashboard shows for
 * 30 and 90 days must equal the responses that actually fall in those windows,
 * summed straight from the transcripts without going through `dailyUsage`.
 *
 * Opt-in via `pnpm verify:accounting` — it reads the user's own history.
 */
const ENABLED = process.env.VERIFY_ACCOUNTING === '1'

function transcripts(root: string): string[] {
  const found: string[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > 3) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, depth + 1)
      else if (entry.name.endsWith('.jsonl')) found.push(full)
    }
  }
  walk(root, 0)
  return found
}

/**
 * A date range covering the last N days. 30 days has a preset; 90 no longer
 * does, so it is expressed as the equivalent custom window — the arithmetic
 * under test is the same either way.
 */
function rangeForDays(days: number): DateRange {
  if (days === 30) return '30d'
  return { preset: 'custom', from: windowStart(days), to: toDateKey(new Date()) }
}

/** First day of an N-day window ending today, as a local YYYY-MM-DD key. */
function windowStart(days: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - (days - 1))
  return toDateKey(d)
}

/**
 * Both passes must read identical bytes. Claude Code appends to transcripts
 * while this runs — including the session running it — so reading the live
 * directory twice produces a small, real difference that has nothing to do with
 * the arithmetic under test. Freezing a copy removes that race.
 */
function freezeHistory(source: string): string {
  const frozen = fs.mkdtempSync(path.join(os.tmpdir(), 'claudewatch-history-'))
  fs.cpSync(source, path.join(frozen, 'projects'), { recursive: true })
  return path.join(frozen, 'projects')
}

describe.skipIf(!ENABLED)('date-range analytics against real history', () => {
  // Frozen in a hook, not in the suite body: a suite body runs during
  // collection even when `skipIf` will skip every test in it, so touching the
  // history here crashed the run on any machine without a ~/.claude — CI, for
  // one. Hooks of a skipped suite never run.
  let root: string
  beforeAll(() => {
    root = freezeHistory(getProjectsDirPath())
  })

  it('30d and 90d totals match the responses that fall in those windows', async () => {
    const files = transcripts(root)
    const parents = files.filter((f) => !f.includes(`${path.sep}subagents${path.sep}`))

    // Independent oracle: every response, bucketed by its own local day,
    // straight from the transcripts.
    const byDay = new Map<string, { tokens: number; cost: number; models: Set<string> }>()
    for (const file of files) {
      const { entries } = await ingestFile(
        file,
        { kind: 'parent', projectId: 'p', sessionId: 's' },
        ANTHROPIC_PRICING
      )
      for (const e of entries) {
        let bucket = byDay.get(e.dayLocal)
        if (!bucket) {
          bucket = { tokens: 0, cost: 0, models: new Set() }
          byDay.set(e.dayLocal, bucket)
        }
        bucket.tokens += e.inputTokens + e.outputTokens
        bucket.cost += e.costUsd ?? 0
        bucket.models.add(e.modelFamily)
      }
    }

    const summaries: SessionSummary[] = []
    for (const file of parents) {
      summaries.push(
        await parseSessionMetadata(
          file,
          path.basename(file, '.jsonl'),
          path.basename(path.dirname(file)),
          ANTHROPIC_PRICING
        )
      )
    }
    const projects: Project[] = [...new Set(summaries.map((s) => s.projectId))].map((id) => ({
      id,
      name: id,
      path: id,
      pathResolved: true,
      sessions: [],
      sessionCount: 0,
      localSkills: [],
      localClaudeMd: null,
    }))

    for (const days of [30, 90] as const) {
      const start = windowStart(days)
      const expected = [...byDay.entries()]
        .filter(([day]) => day >= start)
        .reduce(
          (acc, [, v]) => ({
            tokens: acc.tokens + v.tokens,
            cost: acc.cost + v.cost,
            models: new Set([...acc.models, ...v.models]),
          }),
          { tokens: 0, cost: 0, models: new Set<string>() }
        )

      const actual = computeAnalytics(summaries, projects, rangeForDays(days), ANTHROPIC_PRICING)
      const activeDays = [...byDay.keys()].filter((d) => d >= start).length

      console.log(
        `\n  ${days}d (from ${start})` +
          `\n    tokens   expected ${expected.tokens.toLocaleString()}  actual ${actual.totalTokens.toLocaleString()}` +
          `\n    cost     expected $${expected.cost.toFixed(2)}  actual $${actual.totalCost.toFixed(2)}` +
          `\n    models   expected ${[...expected.models].sort().join(',')}` +
          `\n             actual   ${actual.modelUsage
            .map((m) => m.model)
            .sort()
            .join(',')}` +
          `\n    days     ${activeDays} active, ${actual.dailyUsage.length} in series` +
          `\n    sessions ${actual.totalSessions}`
      )

      expect(actual.totalTokens).toBe(expected.tokens)
      expect(actual.totalCost).toBeCloseTo(expected.cost, 6)
      expect(actual.modelUsage.map((m) => m.model).sort()).toEqual([...expected.models].sort())
      // One point per calendar day in the window, active or idle — a bounded
      // range is now zero-filled (see `analytics-engine.ts`'s `dailyUsage`
      // construction), which is what makes `windowStart(days)` to today
      // exactly `days` long regardless of how many of those days had
      // activity. `activeDays` (logged above) is strictly <= this.
      expect(actual.dailyUsage.length).toBe(days)
      // No point is invented outside the window, and idle days add nothing:
      // summing the series must still equal the independently-computed total.
      expect(actual.dailyUsage.reduce((sum, d) => sum + d.inputTokens + d.outputTokens, 0)).toBe(
        expected.tokens
      )
      // Every point must fall inside the window.
      for (const point of actual.dailyUsage) expect(point.date >= start).toBe(true)
    }
  }, 240_000)

  it('"all" covers every day in the history and a custom window covers only its own', async () => {
    const files = transcripts(root)
    const parents = files.filter((f) => !f.includes(`${path.sep}subagents${path.sep}`))

    const byDay = new Map<string, { tokens: number; cost: number }>()
    for (const file of files) {
      const { entries } = await ingestFile(
        file,
        { kind: 'parent', projectId: 'p', sessionId: 's' },
        ANTHROPIC_PRICING
      )
      for (const e of entries) {
        const bucket = byDay.get(e.dayLocal) ?? { tokens: 0, cost: 0 }
        bucket.tokens += e.inputTokens + e.outputTokens
        bucket.cost += e.costUsd ?? 0
        byDay.set(e.dayLocal, bucket)
      }
    }

    const summaries: SessionSummary[] = []
    for (const file of parents) {
      summaries.push(
        await parseSessionMetadata(
          file,
          path.basename(file, '.jsonl'),
          path.basename(path.dirname(file)),
          ANTHROPIC_PRICING
        )
      )
    }

    const allDays = [...byDay.keys()].sort()
    const today = toDateKey(new Date())

    // ── all ────────────────────────────────────────────────────────────────
    const everything = allDays
      .filter((d) => d <= today)
      .reduce(
        (acc, d) => ({
          tokens: acc.tokens + byDay.get(d)!.tokens,
          cost: acc.cost + byDay.get(d)!.cost,
        }),
        { tokens: 0, cost: 0 }
      )
    const all = computeAnalytics(summaries, [], 'all', ANTHROPIC_PRICING)
    console.log(
      `\n  all (${allDays[0]} → ${today})` +
        `\n    tokens   expected ${everything.tokens.toLocaleString()}  actual ${all.totalTokens.toLocaleString()}` +
        `\n    cost     expected $${everything.cost.toFixed(2)}  actual $${all.totalCost.toFixed(2)}` +
        `\n    days     ${all.dailyUsage.length}   sessions ${all.totalSessions}`
    )
    expect(all.totalTokens).toBe(everything.tokens)
    expect(all.totalCost).toBeCloseTo(everything.cost, 6)
    expect(all.totalSessions).toBe(summaries.length)

    // ── custom: an interior window, so both edges are exercised ────────────
    const from = allDays[Math.floor(allDays.length / 3)]
    const to = allDays[Math.floor((allDays.length * 2) / 3)]
    const inWindow = allDays
      .filter((d) => d >= from && d <= to)
      .reduce(
        (acc, d) => ({
          tokens: acc.tokens + byDay.get(d)!.tokens,
          cost: acc.cost + byDay.get(d)!.cost,
        }),
        { tokens: 0, cost: 0 }
      )
    const custom = computeAnalytics(
      summaries,
      [],
      { preset: 'custom', from, to },
      ANTHROPIC_PRICING
    )
    console.log(
      `\n  custom (${from} → ${to})` +
        `\n    tokens   expected ${inWindow.tokens.toLocaleString()}  actual ${custom.totalTokens.toLocaleString()}` +
        `\n    cost     expected $${inWindow.cost.toFixed(2)}  actual $${custom.totalCost.toFixed(2)}` +
        `\n    days     ${custom.dailyUsage.length}   sessions ${custom.totalSessions}`
    )
    expect(custom.totalTokens).toBe(inWindow.tokens)
    expect(custom.totalCost).toBeCloseTo(inWindow.cost, 6)
    for (const point of custom.dailyUsage) {
      expect(point.date >= from && point.date <= to).toBe(true)
    }

    // A single-day custom range must equal that day exactly.
    const oneDay = allDays[allDays.length - 2]
    const single = computeAnalytics(
      summaries,
      [],
      { preset: 'custom', from: oneDay, to: oneDay },
      ANTHROPIC_PRICING
    )
    console.log(
      `\n  custom single day (${oneDay})` +
        `\n    tokens   expected ${byDay.get(oneDay)!.tokens.toLocaleString()}  actual ${single.totalTokens.toLocaleString()}`
    )
    expect(single.totalTokens).toBe(byDay.get(oneDay)!.tokens)
    expect(single.dailyUsage.map((d) => d.date)).toEqual([oneDay])
  }, 240_000)

  it('latency counts only turns that happened inside the window', async () => {
    const { parseSessionMetadata } = await import('@main/services/parsers/metadata-parser')
    const { computeAnalytics } = await import('@main/services/analytics-engine')
    const parents = transcripts(root).filter((f) => !f.includes(`${path.sep}subagents${path.sep}`))

    const summaries: SessionSummary[] = []
    for (const file of parents) {
      summaries.push(
        await parseSessionMetadata(
          file,
          path.basename(file, '.jsonl'),
          path.basename(path.dirname(file)),
          ANTHROPIC_PRICING
        )
      )
    }

    for (const days of [30, 90] as const) {
      const start = windowStart(days)
      // Oracle: count the turns whose own timestamp falls in the window.
      //
      // The `!t.assistantTimestamp ||` disjunct that used to lead this filter
      // mirrored an `if (td.assistantTimestamp)` guard in
      // `computeLatencyAnalytics` that kept a timestamp-less turn in every
      // range unconditionally. Both are gone: an undated turn is now excluded
      // from a calendar window it cannot honestly claim, matching that
      // function's stated policy. The set is empty either way — `judgeResponse`
      // never emits a turn duration without a parsable timestamp (pinned in
      // `response-observability.test.ts`) — so this edit changes no number
      // here; it stops the oracle from asserting a policy the code no longer
      // implements.
      const expected = summaries
        .flatMap((s) => s.turnDurations ?? [])
        .filter((t) => t.durationMs > 0)
        .filter((t) => t.assistantTimestamp !== undefined)
        .filter((t) => toDateKey(t.assistantTimestamp!) >= start).length

      const actual = computeAnalytics(summaries, [], rangeForDays(days), ANTHROPIC_PRICING)
      const counted = actual.latencyAnalytics.histogram.reduce((n, b) => n + b.count, 0)

      console.log(`\n  ${days}d latency turns  expected ${expected}  actual ${counted}`)
      expect(counted).toBe(expected)
    }
  }, 240_000)

  it('a narrower window is a strict subset of a wider one', async () => {
    const files = transcripts(root).filter((f) => !f.includes(`${path.sep}subagents${path.sep}`))
    const summaries: SessionSummary[] = []
    for (const file of files) {
      summaries.push(
        await parseSessionMetadata(
          file,
          path.basename(file, '.jsonl'),
          path.basename(path.dirname(file)),
          ANTHROPIC_PRICING
        )
      )
    }

    const d30 = computeAnalytics(summaries, [], '30d', ANTHROPIC_PRICING)
    const d90 = computeAnalytics(summaries, [], rangeForDays(90), ANTHROPIC_PRICING)

    expect(d30.totalTokens).toBeLessThanOrEqual(d90.totalTokens)
    expect(d30.totalCost).toBeLessThanOrEqual(d90.totalCost + 1e-9)
    expect(d30.dailyUsage.length).toBeLessThanOrEqual(d90.dailyUsage.length)
    expect(d30.totalSessions).toBeLessThanOrEqual(d90.totalSessions)
  }, 240_000)
})
