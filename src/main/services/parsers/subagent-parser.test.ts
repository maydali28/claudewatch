import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ANTHROPIC_PRICING } from '@shared/constants/pricing'
import { parseSubagents } from './subagent-parser'

let dir: string
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-parser-'))
})
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('parseSubagents', () => {
  it('counts a block-split child response once and ignores replayed uuids', async () => {
    const parent = path.join(dir, 'sess.jsonl')
    fs.writeFileSync(parent, '')
    const subdir = path.join(dir, 'sess', 'subagents')
    fs.mkdirSync(subdir, { recursive: true })

    const lines = [
      {
        type: 'user',
        uuid: 'cu1',
        timestamp: '2026-09-10T10:00:00.000Z',
        message: { content: [{ type: 'text', text: 'do it' }] },
      },
      {
        type: 'assistant',
        uuid: 'ca1',
        timestamp: '2026-09-10T10:00:01.000Z',
        message: {
          id: 'cmsg_1',
          model: 'claude-opus-5',
          content: [{ type: 'thinking', thinking: 'x' }],
          usage: { input_tokens: 1, output_tokens: 5 },
        },
      },
      {
        type: 'assistant',
        uuid: 'ca2',
        timestamp: '2026-09-10T10:00:02.000Z',
        message: {
          id: 'cmsg_1',
          model: 'claude-opus-5',
          content: [{ type: 'text', text: 'done' }],
          usage: { input_tokens: 1, output_tokens: 5 },
        },
      },
      {
        type: 'assistant',
        uuid: 'ca2',
        timestamp: '2026-09-10T10:00:02.000Z',
        message: {
          id: 'cmsg_1',
          model: 'claude-opus-5',
          content: [{ type: 'text', text: 'done' }],
          usage: { input_tokens: 1, output_tokens: 5 },
        },
      },
    ]
    fs.writeFileSync(
      path.join(subdir, 'agent-abc.jsonl'),
      lines.map((l) => JSON.stringify(l)).join('\n')
    )

    const { summaries } = await parseSubagents(parent, 'sess', 'proj', ANTHROPIC_PRICING)
    expect(summaries).toHaveLength(1)
    expect(summaries[0].messageCount).toBe(2)
  })

  it('reports a malformed line in a subagent transcript', async () => {
    const parent = path.join(dir, 'sess-malformed.jsonl')
    fs.writeFileSync(parent, '')
    const subdir = path.join(dir, 'sess-malformed', 'subagents')
    fs.mkdirSync(subdir, { recursive: true })

    const goodLine = {
      type: 'assistant',
      uuid: 'ca1',
      timestamp: '2026-09-10T10:00:01.000Z',
      message: {
        id: 'cmsg_1',
        model: 'claude-opus-5',
        content: [{ type: 'text', text: 'done' }],
        usage: { input_tokens: 1, output_tokens: 5 },
      },
    }
    fs.writeFileSync(
      path.join(subdir, 'agent-bad-line.jsonl'),
      ['{not json', JSON.stringify(goodLine)].join('\n')
    )

    const { diagnostics } = await parseSubagents(
      parent,
      'sess-malformed',
      'proj',
      ANTHROPIC_PRICING
    )

    expect(diagnostics.malformedLines).toBe(1)
    expect(diagnostics.unreadableChildren).toBe(0)
  })

  /**
   * A subagent file that `readdir` reported but that cannot actually be read
   * — a permissions problem, a transient fs error, or (as forced here) a real
   * ENOENT on a path `readdir` claimed existed — used to become `null` from
   * `parseSingleSubagent`, indistinguishable from "no subagents here" and
   * therefore invisible: the child's usage silently drops out of the parent's
   * rollup with no signal that anything went wrong.
   */
  it('counts a subagent file that fails to read as an unreadable child', async () => {
    const parent = path.join(dir, 'sess-unreadable.jsonl')
    fs.writeFileSync(parent, '')
    const subdir = path.join(dir, 'sess-unreadable', 'subagents')
    fs.mkdirSync(subdir, { recursive: true })
    // Never actually created on disk — `readdir` is made to report it anyway,
    // so opening it fails with a genuine ENOENT rather than a mocked error.
    // (`fs.createReadStream` itself can't be spied on: vitest can't redefine
    // an ESM namespace export.)
    const fakeEntry = { name: 'agent-broken.jsonl', isFile: () => true } as fs.Dirent
    vi.spyOn(fs.promises, 'readdir').mockResolvedValueOnce([fakeEntry] as never)

    const { summaries, diagnostics } = await parseSubagents(
      parent,
      'sess-unreadable',
      'proj',
      ANTHROPIC_PRICING
    )

    expect(summaries).toHaveLength(0)
    expect(diagnostics.unreadableChildren).toBe(1)
  })
})

/**
 * Task 6: before this fix, `SubagentDiagnostics` carried only
 * `malformedLines`/`unreadableChildren`/`negativeCounters` — a subagent whose
 * usage was unpriceable, incomplete, without-completion-signal or reduced-confidence
 * dropped that fact entirely once rolled up into the parent session, because
 * the aggregate the parent combines from had no field to carry it in. These
 * pin that the child's own `projectUsage` completeness counts now reach
 * `parseSubagents`'s returned `diagnostics`.
 */
describe('parseSubagents — completeness contract', () => {
  it('reports the incomplete-usage count when a subagent response is missing output', async () => {
    const parent = path.join(dir, 'sess-incomplete.jsonl')
    fs.writeFileSync(parent, '')
    const subdir = path.join(dir, 'sess-incomplete', 'subagents')
    fs.mkdirSync(subdir, { recursive: true })

    const line = {
      type: 'assistant',
      uuid: 'ca1',
      timestamp: '2026-09-10T10:00:01.000Z',
      message: {
        id: 'cmsg_1',
        model: 'claude-opus-5',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'done' }],
        // `output_tokens` deliberately omitted.
        usage: { input_tokens: 1, cache_read_input_tokens: 0 },
      },
    }
    fs.writeFileSync(path.join(subdir, 'agent-abc.jsonl'), JSON.stringify(line))

    const { diagnostics } = await parseSubagents(
      parent,
      'sess-incomplete',
      'proj',
      ANTHROPIC_PRICING
    )

    expect(diagnostics.incompleteUsageResponses).toBe(1)
    expect(diagnostics.unpricedResponses).toBe(0)
    expect(diagnostics.responsesWithoutCompletionSignal).toBe(0)
    expect(diagnostics.reducedConfidenceResponses).toBe(0)
  })

  it('distinguishes unpriced, no-completion-signal and reduced-confidence subagent responses from each other', async () => {
    const parent = path.join(dir, 'sess-distinguish.jsonl')
    fs.writeFileSync(parent, '')
    const subdir = path.join(dir, 'sess-distinguish', 'subagents')
    fs.mkdirSync(subdir, { recursive: true })

    const unpriced = {
      type: 'assistant',
      uuid: 'ca1',
      timestamp: '2026-09-10T10:00:01.000Z',
      message: {
        id: 'cmsg_1',
        model: 'totally-unrecognised-model-xyz',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'done' }],
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
      },
    }
    const noCompletionSignal = {
      type: 'assistant',
      uuid: 'ca2',
      timestamp: '2026-09-10T10:00:02.000Z',
      message: {
        id: 'cmsg_2',
        model: 'claude-opus-5',
        // No `stop_reason` — no completion signal.
        content: [{ type: 'text', text: 'done' }],
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
      },
    }
    const reducedConfidence = {
      type: 'assistant',
      uuid: 'ca3',
      timestamp: '2026-09-10T10:00:03.000Z',
      message: {
        // No `id` — identity falls back to the record uuid.
        model: 'claude-opus-5',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'done' }],
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
      },
    }
    fs.writeFileSync(
      path.join(subdir, 'agent-abc.jsonl'),
      [unpriced, noCompletionSignal, reducedConfidence].map((l) => JSON.stringify(l)).join('\n')
    )

    const { diagnostics } = await parseSubagents(
      parent,
      'sess-distinguish',
      'proj',
      ANTHROPIC_PRICING
    )

    expect(diagnostics).toMatchObject({
      unpricedResponses: 1,
      incompleteUsageResponses: 0,
      responsesWithoutCompletionSignal: 1,
      reducedConfidenceResponses: 1,
    })
  })

  it('zeroes the completeness fields when there is no subagents directory at all', async () => {
    const parent = path.join(dir, 'sess-no-subagents.jsonl')
    fs.writeFileSync(parent, '')

    const { diagnostics } = await parseSubagents(
      parent,
      'sess-no-subagents',
      'proj',
      ANTHROPIC_PRICING
    )

    expect(diagnostics).toEqual({
      malformedLines: 0,
      unreadableChildren: 0,
      negativeCounters: 0,
      unpricedResponses: 0,
      incompleteUsageResponses: 0,
      responsesWithoutCompletionSignal: 0,
      reducedConfidenceResponses: 0,
    })
  })
})

/**
 * Step 2b (from Task 4's review): `ModelTokenBreakdown` — the per-model shape
 * on `SubagentSummary.modelBreakdown` — carried no field for a cache write
 * whose TTL tiers under-report the flat counter, the same split-quantity bug
 * class fixed on the projection surface by `cacheWriteUnknownTtl`. The two
 * known tiers plus this new field must sum to the effective write total the
 * response's cost was actually computed from.
 */
describe('parseSubagents — cache-write unknown-TTL remainder on modelBreakdown', () => {
  it('reports the flat-minus-tiers remainder separately, summing back to the effective total', async () => {
    const parent = path.join(dir, 'sess-unknown-ttl.jsonl')
    fs.writeFileSync(parent, '')
    const subdir = path.join(dir, 'sess-unknown-ttl', 'subagents')
    fs.mkdirSync(subdir, { recursive: true })

    const line = {
      type: 'assistant',
      uuid: 'ca1',
      timestamp: '2026-09-10T10:00:01.000Z',
      message: {
        id: 'cmsg_1',
        model: 'claude-opus-5',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'done' }],
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          // Only 40 of the flat 100 is explained by a TTL tier.
          cache_creation_input_tokens: 100,
          cache_creation: { ephemeral_5m_input_tokens: 40, ephemeral_1h_input_tokens: 0 },
        },
      },
    }
    fs.writeFileSync(path.join(subdir, 'agent-abc.jsonl'), JSON.stringify(line))

    const { summaries } = await parseSubagents(
      parent,
      'sess-unknown-ttl',
      'proj',
      ANTHROPIC_PRICING
    )

    const row = summaries[0].modelBreakdown[0]
    expect(row.cacheCreationUnknownTtlTokens).toBe(60)
    expect(
      row.cacheCreation5mTokens + row.cacheCreation1hTokens + row.cacheCreationUnknownTtlTokens
    ).toBe(100)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})
