import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ANTHROPIC_PRICING } from '@shared/constants/pricing'
import { ingestFile, type SourceIdentity } from './ledger'

/**
 * Runs the ledger against the real `~/.claude` history and reports what it
 * finds. Opt-in via `pnpm verify:accounting`, because it reads the user's own
 * transcripts — it must never run in CI, and it asserts on invariants rather
 * than on numbers that differ per machine.
 *
 * This is the only check that exercises the ledger at real scale and against
 * real record shapes. Fixtures verify the behaviour we thought to write down;
 * this verifies the behaviour the data actually exhibits.
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

describe.skipIf(!ENABLED)('ledger against real ~/.claude history', () => {
  const root = path.join(os.homedir(), '.claude', 'projects')

  it('ingests the whole history and reports its shape', async () => {
    const files = transcripts(root)
    expect(files.length).toBeGreaterThan(0)

    let responses = 0
    let duplicateRecords = 0
    let conflicts = 0
    let malformed = 0
    let unpriced = 0
    let cost = 0
    const models = new Map<string, number>()
    const unknownModels = new Map<string, number>()

    const started = Date.now()
    for (const file of files) {
      const source: SourceIdentity = {
        kind: file.includes(`${path.sep}subagents${path.sep}`) ? 'subagent' : 'parent',
        projectId: path.basename(path.dirname(file)),
        sessionId: path.basename(file, '.jsonl'),
      }
      const { entries, malformedLines } = await ingestFile(file, source, ANTHROPIC_PRICING)
      malformed += malformedLines
      for (const e of entries) {
        responses++
        duplicateRecords += e.snapshotCount - 1
        if (e.usageConflict) conflicts++
        if (e.costUsd === null) {
          unpriced++
          unknownModels.set(
            e.modelRaw ?? '(none)',
            (unknownModels.get(e.modelRaw ?? '(none)') ?? 0) + 1
          )
        } else {
          cost += e.costUsd
        }
        models.set(e.modelFamily, (models.get(e.modelFamily) ?? 0) + 1)
      }
    }
    const elapsedMs = Date.now() - started

    console.log('\n  Ledger verification against real history')
    console.log(`  files                ${files.length}`)
    console.log(`  responses            ${responses.toLocaleString()}`)
    console.log(`  duplicate records    ${duplicateRecords.toLocaleString()} (collapsed)`)
    console.log(`  usage conflicts      ${conflicts}`)
    console.log(`  malformed lines      ${malformed}`)
    console.log(`  unpriced responses   ${unpriced}`)
    console.log(`  total cost           $${cost.toFixed(2)}`)
    console.log(`  full rebuild         ${(elapsedMs / 1000).toFixed(1)}s`)
    console.log(
      `  models               ${[...models.entries()].map(([m, n]) => `${m}=${n}`).join(' ')}`
    )
    if (unknownModels.size > 0) {
      console.log(
        `  UNRECOGNISED         ${[...unknownModels.entries()].map(([m, n]) => `${m}=${n}`).join(' ')}`
      )
    }

    // Every response must be attributable and priced-or-explicitly-unpriced.
    expect(conflicts).toBe(0)
    expect(unknownModels.size).toBe(0)
  }, 120_000)

  /**
   * The end-to-end oracle: what the app displays must equal what the ledger
   * says. Session summaries are built from parent transcripts and roll their
   * subagents in, so summing them across every project must reproduce the
   * ledger total over every file — parents and children alike.
   */
  it('session summaries reconcile with the ledger across the whole history', async () => {
    const { parseSessionMetadata } = await import('@main/services/parsers/metadata-parser')
    const parents = transcripts(root).filter((f) => !f.includes(`${path.sep}subagents${path.sep}`))

    let ledgerCost = 0
    let ledgerOutput = 0
    for (const file of transcripts(root)) {
      const { entries } = await ingestFile(
        file,
        { kind: 'parent', projectId: 'p', sessionId: 's' },
        ANTHROPIC_PRICING
      )
      for (const e of entries) {
        ledgerCost += e.costUsd ?? 0
        ledgerOutput += e.outputTokens
      }
    }

    let summaryCost = 0
    let summaryOutput = 0
    for (const file of parents) {
      const summary = await parseSessionMetadata(
        file,
        path.basename(file, '.jsonl'),
        path.basename(path.dirname(file)),
        ANTHROPIC_PRICING
      )
      summaryCost += summary.estimatedCost
      summaryOutput += summary.totalOutputTokens
    }

    console.log(
      `\n  summaries $${summaryCost.toFixed(2)} / ${summaryOutput.toLocaleString()} output` +
        `\n  ledger    $${ledgerCost.toFixed(2)} / ${ledgerOutput.toLocaleString()} output`
    )

    expect(summaryOutput).toBe(ledgerOutput)
    expect(summaryCost).toBeCloseTo(ledgerCost, 6)
  }, 180_000)

  /**
   * Multi-day sessions are the case the old attribution got wrong, so confirm
   * they exist in real data and that their usage is genuinely spread rather
   * than piled onto the last day.
   */
  it('spreads multi-day sessions across the days they ran', async () => {
    const { parseSessionMetadata } = await import('@main/services/parsers/metadata-parser')
    const parents = transcripts(root).filter((f) => !f.includes(`${path.sep}subagents${path.sep}`))

    let multiDay = 0
    let widest = 0
    let misattributed = 0

    for (const file of parents) {
      const summary = await parseSessionMetadata(
        file,
        path.basename(file, '.jsonl'),
        path.basename(path.dirname(file)),
        ANTHROPIC_PRICING
      )
      const days = summary.dailyUsage
      if (days.length <= 1) continue
      multiDay++
      widest = Math.max(widest, days.length)

      // Under the old rule every one of these tokens landed on the last day.
      const lastDay = days[days.length - 1]
      const earlier =
        summary.totalInputTokens +
        summary.totalOutputTokens -
        (lastDay.inputTokens + lastDay.outputTokens)
      if (earlier > 0) misattributed++
    }

    console.log(
      `\n  multi-day sessions        ${multiDay}` +
        `\n  widest span (days)        ${widest}` +
        `\n  previously misattributed  ${misattributed}`
    )

    expect(multiDay).toBeGreaterThan(0)
  }, 180_000)

  it('is idempotent on the largest transcript', async () => {
    const files = transcripts(root)
    const largest = files
      .map((f) => ({ f, size: fs.statSync(f).size }))
      .sort((a, b) => b.size - a.size)[0]
    const source: SourceIdentity = { kind: 'parent', projectId: 'p', sessionId: 's' }

    const first = await ingestFile(largest.f, source, ANTHROPIC_PRICING)
    const second = await ingestFile(largest.f, source, ANTHROPIC_PRICING)

    expect(second.entries.length).toBe(first.entries.length)
    expect(second.entries.reduce((s, e) => s + e.outputTokens, 0)).toBe(
      first.entries.reduce((s, e) => s + e.outputTokens, 0)
    )
  }, 60_000)
})
