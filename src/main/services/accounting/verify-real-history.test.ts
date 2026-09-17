import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ANTHROPIC_PRICING } from '@shared/constants/pricing'
import { UNDATED_DAY } from '@shared/utils/date-ranges'
import type { EffortDistribution } from '@shared/types/session'
import { getProjectsDirPath } from '@main/lib/claude-paths'
import { ingestFile, type SourceIdentity } from './ledger'
import { projectUsage } from './projection'

// See metadata-parser.test.ts for why this mock exists (vitest's `forks` pool
// makes `@main/lib/logger`'s import-time electron-log init throw). Required
// here too since this file dynamically imports metadata-parser.ts below.
vi.mock('@main/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

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

/**
 * Task 9 review (finding 3): counting `ResponseEntry.thinkingTokens` here
 * instead of the raw field would be vacuous — `toEntry` in `ledger.ts`
 * already scrubs an invalid raw `thinking_tokens` to `undefined` before it
 * can ever reach a `ResponseEntry`, so that field can never be negative or
 * non-finite by construction, and a check against it can never fail no
 * matter what garbage is sitting in the corpus. Reads each raw record
 * directly instead, independent of `ingestFile`'s own parsing (and
 * duplicating `isMeasured`'s shape check by hand rather than importing it,
 * for the same reason), so a genuinely malformed `thinking_tokens` value in
 * the corpus has something that would actually flag it. Tolerant of
 * malformed JSON lines the same way `ingestFile` is — this is a raw-shape
 * survey, not a source of billing truth, so it does not need to reproduce
 * `ingestFile`'s dedup/compaction-filtering logic to be meaningful.
 */
function rawThinkingShapeIssues(filePath: string): number {
  let issues = 0
  for (const line of fs.readFileSync(filePath, 'utf-8').split('\n')) {
    if (!line.trim()) continue
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    const rec = record as {
      type?: string
      message?: { usage?: { output_tokens_details?: { thinking_tokens?: unknown } } }
    }
    if (rec.type !== 'assistant') continue
    const raw = rec.message?.usage?.output_tokens_details?.thinking_tokens
    if (raw === undefined) continue
    const isMeasured = typeof raw === 'number' && Number.isFinite(raw) && raw >= 0
    if (!isMeasured) issues++
  }
  return issues
}

/**
 * Distinct billable responses in one transcript, counted straight from the
 * raw lines without going through `ingestFile` — the oracle for "the ledger
 * drops nothing".
 *
 * Exists because a silent drop inside `toEntry` is invisible to every other
 * check in this file: a dropped response takes its tokens and its cost with
 * it, so no total it would have contributed to is left holding a discrepancy
 * to notice. That is exactly how `toEntry`'s `if (!timestamp) return null`
 * deleted every absent-timestamp response's spend for as long as it stood —
 * on a corpus that happened to contain none, but with nothing here that
 * would have said so if it had.
 *
 * What it detects and what it does not, stated plainly. It counts real
 * numbers on both sides (~32,000 responses), so it fails the moment the
 * ledger emits fewer or more entries than the raw records justify — a new
 * drop guard, a broken dedup, a grouping rule that splits or merges
 * differently. It does NOT independently justify the admission rules
 * themselves: `add()`'s filters (assistant type, not a compact summary, not
 * transcript-only, not `<synthetic>`, record-uuid dedup, usage present) and
 * the response-identity rule are RE-STATED here by hand from the raw record
 * shape, so a change that is wrong in both places at once is invisible to
 * it. The filters are pinned against fixtures in `ledger.test.ts` instead;
 * this pins that nothing is lost between them and the entry list.
 */
function rawBillableResponseIds(filePath: string): Set<string> {
  const ids = new Set<string>()
  const seenUuids = new Set<string>()
  for (const line of fs.readFileSync(filePath, 'utf-8').split('\n')) {
    if (!line.trim()) continue
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    const rec = record as {
      type?: string
      uuid?: string
      timestamp?: string
      isCompactSummary?: boolean
      isVisibleInTranscriptOnly?: boolean
      message?: { id?: string; model?: string; usage?: unknown }
    }
    if (rec.type !== 'assistant') continue
    if (rec.isCompactSummary === true) continue
    if (rec.isVisibleInTranscriptOnly === true) continue
    if (rec.message?.model === '<synthetic>') continue
    // Same order as `add()`: a repeated record uuid is discarded before the
    // usage check, so a duplicate of a usage-less record cannot resurrect it.
    if (rec.uuid) {
      if (seenUuids.has(rec.uuid)) continue
      seenUuids.add(rec.uuid)
    }
    if (!rec.message?.usage) continue
    const id = rec.message?.id
    ids.add(id ? id : `uuid:${rec.uuid ?? rec.timestamp ?? ''}`)
  }
  return ids
}

describe.skipIf(!ENABLED)('ledger against real ~/.claude history', () => {
  const root = getProjectsDirPath()

  // Say which history is being verified: CLAUDE_CONFIG_DIR relocates it.
  beforeAll(() => {
    console.log(`\n  Verifying history in ${root}`)
  })

  it('ingests the whole history and reports its shape', async () => {
    const files = transcripts(root)
    expect(files.length).toBeGreaterThan(0)

    let responses = 0
    let duplicateRecords = 0
    let conflicts = 0
    let malformed = 0
    let unpriced = 0
    let incompleteUsage = 0
    let cost = 0
    // Task 14: the effective cache-write volume minus what the tiers explain
    // — the same quantity `cacheWriteUnknownTtl` in `ledger.ts` computes.
    // Measured to be 0 across the whole real history — every response either
    // has a flat total that equals 5m+1h, or has no flat total at all (see
    // the "0 tier/flat mismatches" fact the `incompleteUsage` comment below
    // relies on) — so the real corpus never exercises the "tiers exceed
    // flat" branch Task 4 fixed, and provably never has: that mismatch count
    // is the same 0 this file already asserts on.
    //
    // Task 9's review (finding 1): this used to be `Math.max(0,
    // e.cacheWriteFlat - e.cacheWrite5m - e.cacheWrite1h)`, a real second
    // implementation, until a prior task "simplified" it into a call to the
    // shared `cacheWriteUnknownTtl` helper — which made this an oracle that
    // imports the very code it is meant to check. Restored to an
    // independently-reasoned inline computation below (an if/else derived
    // fresh from the reconciliation rule, not a transcription of the
    // helper's `Math.max` expression), checked against `projectUsage`'s own
    // total for the same entries at the end of this test.
    //
    // Scope, corrected a second time: the previous wording here claimed this
    // assertion "proves projectUsage's AGGREGATION is correct... with no
    // dropped or double-counted response" — an overclaim the review disproved
    // the same way it disproved the first one, by changing `projection.ts`'s
    // `totals.cacheWriteUnknownTtl += cacheWriteUnknownTtl(e)` to `* 2` and
    // rerunning: this test still passed. Every response on this corpus
    // contributes exactly 0 here (see above), and 0 counted once, twice,
    // dropped entirely, or doubled by a stray multiplier all sum to the same
    // 0 — so none of those are visible to this assertion, full stop. What it
    // genuinely detects, and the only thing it can detect on this corpus, is
    // a CONSTANT PER-RESPONSE OFFSET added to (or subtracted from) the
    // unknown-TTL contribution: injecting `+ 1` into that same accumulation
    // does not cancel to 0 across ~31,000 real responses, and this test fails
    // immediately (confirmed by hand).
    //
    // The tiers-vs-flat CLAMPING formula itself being wrong — whether via the
    // missing clamp or an accidental multiplier — is guarded by fixture tests
    // carrying a NON-ZERO unknown-TTL value instead, where a wrong constant
    // is visible against a fixed expectation: `ledger.test.ts`'s "prices the
    // full tier sum, not the smaller flat counter" and "keeps pricing the
    // tier sum after a merge reprices the response", and `projection.test.ts`'s
    // "prices and counts the same write volume when tiers exceed the flat
    // total" — all three fail under the unclamped-subtraction regression
    // (confirmed by hand: exactly these three go red, no others). Those
    // `projection.test.ts` fixtures are themselves single-entry, so they
    // cannot distinguish a wrong formula from that one entry being silently
    // dropped or doubled by the aggregation loop — they only happen to make
    // either failure visible because their expected total is non-zero. I did
    // not find an existing fixture that aggregates SEVERAL entries with
    // non-zero `cacheWriteUnknownTtl` values specifically to pin a defect
    // that drops or duplicates one response's contribution while still
    // summing the others correctly; that gap is left open here rather than
    // claimed as covered.
    let unknownTtlTokens = 0
    let projectionUnknownTtlTokens = 0
    // Task 9 review (finding 3): checking `e.thinkingTokens` (the ledger's
    // own post-validation field) here would be vacuous for the same reason
    // as the unknown-TTL oracle above — `toEntry` already scrubs an invalid
    // raw value to `undefined`, so the ledger's own field can never be
    // negative or non-finite by construction and a check against it can
    // never fail. `rawThinkingShapeIssues` reads the untrusted raw record
    // directly instead, independent of `ingestFile`'s own parsing — see its
    // doc comment above.
    let rawThinkingBadShape = 0
    // See `rawBillableResponseIds`: the independent count of what the ledger
    // should have emitted, so a response silently discarded inside `toEntry`
    // has something that would say so.
    let rawBillableResponses = 0
    // Responses the ledger could not attribute to a calendar day. Reported,
    // not asserted on: 0 today, and the assertion that matters — that such a
    // response keeps its tokens and its cost instead of being dropped — is
    // `rawBillableResponses` above, which counts it whether or not the corpus
    // happens to contain one. An `expect(undated).toBe(0)` here would pass on
    // a corpus that has none for reasons that have nothing to do with the
    // ledger, which is the kind of check this branch has already found six of.
    let undatedResponses = 0
    // A SUBSET of `outputTokens` by definition, so a valid thinking count
    // exceeding it is a genuine, currently-never-observed contradiction —
    // this half CAN legitimately fire on real, well-formed-but-inconsistent
    // data, unlike the raw-shape check above, and is a tripwire in the same
    // style as the tier/iteration checks.
    let thinkingExceedsOutput = 0
    // Task 17: estimate gaps — counted, never priced. Reported, not asserted
    // on: the probe found none in real history, but a user who turns on fast
    // mode or web search is not a defect.
    let pricingModifierResponses = 0
    let serverToolRequests = 0
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
        if (e.dayLocal === UNDATED_DAY) undatedResponses++
        duplicateRecords += e.snapshotCount - 1
        if (e.usageConflict) conflicts++
        if (e.usageIncomplete) incompleteUsage++
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
        // Independent of `cacheWriteUnknownTtl` — see the comment above. The
        // reconciliation rule stated fresh, not transcribed from the
        // helper's `Math.max` expression: when the tiers already explain at
        // least as much as the flat counter, there is no unexplained
        // remainder; otherwise the remainder is whatever the flat counter
        // reports beyond the tiers.
        const tierSum = e.cacheWrite5m + e.cacheWrite1h
        unknownTtlTokens += tierSum >= e.cacheWriteFlat ? 0 : e.cacheWriteFlat - tierSum
        if (e.thinkingTokens !== undefined && e.thinkingTokens > e.outputTokens) {
          thinkingExceedsOutput++
        }
      }
      rawThinkingBadShape += rawThinkingShapeIssues(file)
      rawBillableResponses += rawBillableResponseIds(file).size
      // `projectUsage`'s own total for this file's entries — the production
      // aggregation path, not this test's inline formula above. Summed per
      // file rather than collecting every entry across the whole corpus into
      // one array, to keep this test's memory use in line with the streaming
      // per-file loop it already runs.
      const projected = projectUsage(entries).combined
      projectionUnknownTtlTokens += projected.cacheWriteUnknownTtl
      pricingModifierResponses += projected.pricingModifierResponses
      serverToolRequests += projected.serverToolRequests
    }
    const elapsedMs = Date.now() - started

    console.log('\n  Ledger verification against real history')
    console.log(`  files                ${files.length}`)
    console.log(`  responses            ${responses.toLocaleString()}`)
    console.log(`  duplicate records    ${duplicateRecords.toLocaleString()} (collapsed)`)
    console.log(`  usage conflicts      ${conflicts}`)
    console.log(`  malformed lines      ${malformed}`)
    console.log(`  unpriced responses   ${unpriced}`)
    console.log(`  incomplete usage     ${incompleteUsage}`)
    console.log(`  unknown-TTL tokens   ${unknownTtlTokens.toLocaleString()}`)
    console.log(`  raw billable resp    ${rawBillableResponses.toLocaleString()}`)
    console.log(`  undated responses    ${undatedResponses.toLocaleString()}`)
    console.log(`  raw thinking bad     ${rawThinkingBadShape}`)
    console.log(`  thinking > output    ${thinkingExceedsOutput}`)
    console.log(`  pricing modifiers   ${pricingModifierResponses.toLocaleString()}`)
    console.log(`  server tool requests ${serverToolRequests.toLocaleString()}`)
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
    // All four usageIncomplete shapes are tripwires for data that has never
    // been observed (0 tier/flat mismatches, 0 multi-iteration arrays, 0
    // rejected negative counters, 0 thinking-exceeds-output contradictions —
    // Task 9 — across measured history). A non-zero count here means either
    // the predicate is too broad and is flagging real, priceable usage, or
    // real bad data was found — report it, don't loosen this assertion to
    // make it pass.
    expect(incompleteUsage).toBe(0)
    // Task 9: the same thinking-exceeds-output contradiction folded into
    // `incompleteUsage` above, asserted directly so this specific invariant
    // stays visible on its own rather than only inside that broader bucket.
    expect(thinkingExceedsOutput).toBe(0)
    // Task 9 review (finding 3): checked against the RAW field — see
    // `rawThinkingShapeIssues` — so this is capable of failing if the corpus
    // ever contains a wrong-typed or negative `thinking_tokens`, unlike a
    // check against the ledger's own already-scrubbed field would be.
    expect(rawThinkingBadShape).toBe(0)
    // Task 9's review: an oracle that only prints instead of asserting is no
    // oracle at all — see the comment on `unknownTtlTokens` above. This
    // in-line total and `projectUsage`'s own total must agree exactly.
    expect(unknownTtlTokens).toBe(projectionUnknownTtlTokens)
    // Nothing is dropped between the raw records and the entry list — see
    // `rawBillableResponseIds` for what this does and does not establish.
    // Both sides are real five-figure counts, so this fails on a single lost
    // or invented response, not only on a wholesale change.
    expect(responses).toBe(rawBillableResponses)
  }, 120_000)

  /**
   * The end-to-end oracle: what the app displays must equal what the ledger
   * says. Session summaries are built from parent transcripts and roll their
   * subagents in, so summing them across every project must reproduce the
   * ledger total over every file — parents and children alike.
   */
  it('session summaries reconcile with the ledger across the whole history', async () => {
    const { parseSessionMetadata } = await import('@main/services/parsers/metadata-parser')

    // This describe block only ever runs against a LIVE `~/.claude/projects`
    // — the session running this test is itself appending to it. The ledger
    // pass and the summary pass below are minutes apart on a large history,
    // so a plain re-read of `root` lets the summary pass see bytes the
    // ledger pass never did, and the two totals diverge on live data alone
    // (observed once: summaryOutput 18,031,749 vs ledgerOutput 18,031,525,
    // both passing again moments later at matching higher values). Snapshot
    // every file's current bytes exactly once, into a scratch mirror of the
    // same relative tree, and have both passes read only the snapshot —
    // never the live, still-growing files — so they are guaranteed to see
    // identical input. The mirror preserves relative paths (not just a flat
    // copy) because `parseSessionMetadata` derives a session's subagent
    // directory from its own file path; a flat copy would break that lookup.
    const liveFiles = transcripts(root)
    const snapshotRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudewatch-verify-snapshot-'))
    const snapshotOf = new Map<string, string>()

    try {
      for (const file of liveFiles) {
        const dest = path.join(snapshotRoot, path.relative(root, file))
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.copyFileSync(file, dest)
        snapshotOf.set(file, dest)
      }

      const allSnapshotFiles = [...snapshotOf.values()]
      const parentSnapshotFiles = liveFiles
        .filter((f) => !f.includes(`${path.sep}subagents${path.sep}`))
        .map((f) => snapshotOf.get(f)!)

      let ledgerCost = 0
      let ledgerOutput = 0
      for (const file of allSnapshotFiles) {
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
      for (const file of parentSnapshotFiles) {
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
    } finally {
      fs.rmSync(snapshotRoot, { recursive: true, force: true })
    }
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

  /**
   * Parallel-tool detection was 0 across this history before Task 5's
   * per-response flush, and measured ~1,364 responses / max degree 21 after
   * it. If per-day attribution regressed to summing per record instead of
   * per response, or dropped the day key entirely, these day-level sums would
   * collapse back to zero even though the lifetime observability field still
   * reports the true count — this catches that split.
   */
  it('attributes real parallel-tool activity to specific days, not just the session lifetime', async () => {
    const { parseSessionMetadata } = await import('@main/services/parsers/metadata-parser')
    const parents = transcripts(root).filter((f) => !f.includes(`${path.sep}subagents${path.sep}`))

    let lifetimeGroups = 0
    let lifetimeMaxDegree = 0
    let dailyGroups = 0
    let dailyMaxDegree = 0

    for (const file of parents) {
      const summary = await parseSessionMetadata(
        file,
        path.basename(file, '.jsonl'),
        path.basename(path.dirname(file)),
        ANTHROPIC_PRICING
      )
      lifetimeGroups += summary.observability.parallelToolCallCount
      lifetimeMaxDegree = Math.max(lifetimeMaxDegree, summary.observability.maxParallelDegree)
      for (const d of summary.dailyUsage) {
        dailyGroups += d.parallelToolGroups
        dailyMaxDegree = Math.max(dailyMaxDegree, d.maxParallelDegree)
      }
    }

    console.log(
      `\n  parallel groups   lifetime ${lifetimeGroups.toLocaleString()}  daily-summed ${dailyGroups.toLocaleString()}` +
        `\n  max degree        lifetime ${lifetimeMaxDegree}  daily-max ${dailyMaxDegree}`
    )

    expect(dailyGroups).toBeGreaterThan(0)
    expect(dailyGroups).toBe(lifetimeGroups)
    expect(dailyMaxDegree).toBe(lifetimeMaxDegree)
  }, 180_000)

  /**
   * Same shape as the parallel-tool reconciliation above, but per session and
   * bucket-by-bucket rather than a single aggregate: `flushPendingResponse`
   * increments the lifetime counter and the per-day counter for the same
   * classified `effort` value on adjacent lines, so the two would very likely
   * drift or hold together — but "structurally identical, so presumably
   * fine" is inference, and this task exists because a lifetime figure and a
   * per-day figure had silently disagreed for months. Assert it instead.
   */
  it('reconciles per-day effort distribution with each session’s lifetime observability', async () => {
    const { parseSessionMetadata } = await import('@main/services/parsers/metadata-parser')
    const parents = transcripts(root).filter((f) => !f.includes(`${path.sep}subagents${path.sep}`))

    const mismatches: Array<{
      sessionId: string
      lifetime: EffortDistribution
      daySummed: EffortDistribution
    }> = []

    for (const file of parents) {
      const summary = await parseSessionMetadata(
        file,
        path.basename(file, '.jsonl'),
        path.basename(path.dirname(file)),
        ANTHROPIC_PRICING
      )
      const daySummed = { low: 0, medium: 0, high: 0, ultrathink: 0 }
      for (const d of summary.dailyUsage) {
        daySummed.low += d.effortDistribution.low
        daySummed.medium += d.effortDistribution.medium
        daySummed.high += d.effortDistribution.high
        daySummed.ultrathink += d.effortDistribution.ultrathink
      }
      const lifetime = summary.observability.effortDistribution
      if (
        daySummed.low !== lifetime.low ||
        daySummed.medium !== lifetime.medium ||
        daySummed.high !== lifetime.high ||
        daySummed.ultrathink !== lifetime.ultrathink
      ) {
        mismatches.push({ sessionId: summary.id, lifetime, daySummed })
      }
    }

    expect(mismatches).toEqual([])
  }, 180_000)
})
