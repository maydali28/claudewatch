import * as fs from 'fs'
import * as readline from 'readline'
import type { RawRecord } from '@shared/types/session'
import type { ModelFamily, ModelPricing } from '@shared/types/pricing'
import { getModelFamily } from '@shared/constants/models'
import { estimateCost, PRICING_REVISION } from '@shared/constants/pricing'
import { toDateKey } from '@shared/utils/date-ranges'

/**
 * The accounting ledger: one entry per API response, not per transcript record.
 *
 * Claude Code writes a separate record for each content block of a response —
 * thinking, text, each tool_use — and every one of them repeats the same
 * `message.usage`. Summing per record overstated real usage by 3.5x across
 * measured history. Anthropic's own guidance is to count usage once per API
 * message id, which is what this module does.
 *
 * Everything downstream (totals, day buckets, model breakdowns, cost) is
 * derived from these entries. Nothing else in the app is permitted to add up
 * tokens.
 */

export interface SourceIdentity {
  kind: 'parent' | 'subagent'
  projectId: string
  sessionId: string
  /** Present only for subagent transcripts. */
  agentId?: string
}

export interface ResponseEntry {
  /** `message.id`, or `uuid:<record uuid>` when the response carries no id. */
  responseId: string
  /** Scopes `responseId`, and is the unit of invalidation and re-parse. */
  filePath: string
  kind: 'parent' | 'subagent'
  projectId: string
  sessionId: string
  agentId?: string

  /** This response's own timestamp — never the file's last. */
  tsUtc: string
  /** Calendar day the response is attributed to, in the reporting timezone. */
  dayLocal: string

  /** Exact model string as written, retained even when unrecognised. */
  modelRaw?: string
  modelFamily: ModelFamily

  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWrite5m: number
  cacheWrite1h: number
  /** `cache_creation_input_tokens`, kept independently of the TTL split. */
  cacheWriteFlat: number
  /** A subset of output tokens. Reported for display; never added to output. */
  thinkingTokens?: number

  effortRecorded?: string
  serviceTier?: string
  speed?: string
  inferenceGeo?: string
  /**
   * Server-side iteration usage (compaction, advisor). Captured for provenance
   * and deliberately excluded from the totals above: the docs describe it as a
   * separate ledger, so adding it would replace one overcount with another.
   */
  iterationsRaw?: unknown

  /** How many transcript records carried this response. */
  snapshotCount: number
  /** True if a later record reported different usage for the same response. */
  usageConflict: boolean

  /** Null when the model is unrecognised and therefore cannot be priced. */
  costUsd: number | null
  pricingRevision: number
}

export interface IngestResult {
  entries: ResponseEntry[]
  /** Lines that failed to parse. Surfaced rather than silently swallowed. */
  malformedLines: number
}

/**
 * Every usage field except output. Streaming records revise `output_tokens`
 * upward as the response is generated, so a difference there is expected; a
 * difference anywhere else is not, and stays worth flagging.
 */
function stableUsageFingerprint(e: ResponseEntry): string {
  return [e.inputTokens, e.cacheReadTokens, e.cacheWrite5m, e.cacheWrite1h, e.cacheWriteFlat].join(
    ':'
  )
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

interface RawUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: {
    ephemeral_5m_input_tokens?: number
    ephemeral_1h_input_tokens?: number
  }
  output_tokens_details?: { thinking_tokens?: number }
  iterations?: unknown
  service_tier?: string
  speed?: string
  inference_geo?: string
}

function toEntry(
  raw: RawRecord,
  usage: RawUsage,
  source: SourceIdentity,
  filePath: string,
  pricingTable: Record<ModelFamily, ModelPricing>
): ResponseEntry | null {
  const timestamp = raw.timestamp
  if (!timestamp) return null

  const modelRaw = raw.message?.model ?? undefined
  const modelFamily = getModelFamily(modelRaw)

  const cacheWrite5m = num(usage.cache_creation?.ephemeral_5m_input_tokens)
  const cacheWrite1h = num(usage.cache_creation?.ephemeral_1h_input_tokens)
  // Prefer the reported aggregate; fall back to the tiers when it is absent so
  // a transcript without the flat counter still reports its cache writes.
  const cacheWriteFlat =
    usage.cache_creation_input_tokens !== undefined
      ? num(usage.cache_creation_input_tokens)
      : cacheWrite5m + cacheWrite1h

  const inputTokens = num(usage.input_tokens)
  const outputTokens = num(usage.output_tokens)
  const cacheReadTokens = num(usage.cache_read_input_tokens)

  // Price the tiers when they are known, otherwise the flat total, so an
  // unsplit counter is charged once rather than dropped or double counted.
  const has5mOr1h = cacheWrite5m > 0 || cacheWrite1h > 0
  const costUsd = estimateCost(
    modelFamily,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    has5mOr1h ? cacheWrite5m : cacheWriteFlat,
    has5mOr1h ? cacheWrite1h : 0,
    pricingTable
  )

  const id = raw.message?.id
  const responseId = id ? id : `uuid:${raw.uuid ?? timestamp}`

  return {
    responseId,
    filePath,
    kind: source.kind,
    projectId: source.projectId,
    sessionId: source.sessionId,
    agentId: source.agentId,
    tsUtc: timestamp,
    dayLocal: toDateKey(timestamp),
    modelRaw,
    modelFamily,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWrite5m,
    cacheWrite1h,
    cacheWriteFlat,
    thinkingTokens: usage.output_tokens_details?.thinking_tokens,
    effortRecorded: typeof raw.effort === 'string' ? raw.effort : undefined,
    serviceTier: usage.service_tier,
    speed: usage.speed,
    inferenceGeo: usage.inference_geo,
    iterationsRaw: usage.iterations,
    snapshotCount: 1,
    usageConflict: false,
    costUsd,
    pricingRevision: PRICING_REVISION,
  }
}

/**
 * Read one transcript and return its billable responses, deduplicated.
 *
 * Re-ingesting a file replaces its entries wholesale rather than applying a
 * delta, so replay is idempotent by construction — which is what lets "just
 * re-parse it" serve as the recovery path for any inconsistency. A single file
 * costs ~2ms; the whole history ~1.4s.
 */
export async function ingestFile(
  filePath: string,
  source: SourceIdentity,
  pricingTable: Record<ModelFamily, ModelPricing>
): Promise<IngestResult> {
  const byResponseId = new Map<string, ResponseEntry>()
  const seenRecordUuids = new Set<string>()
  let malformedLines = 0

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let raw: RawRecord
    try {
      raw = JSON.parse(trimmed) as RawRecord
    } catch {
      malformedLines++
      continue
    }

    if (raw.type !== 'assistant') continue
    if (raw.isCompactSummary === true) continue
    if (raw.isVisibleInTranscriptOnly === true) continue
    if (raw.message?.model === '<synthetic>') continue

    // A repeated record uuid is the same stored record seen twice, which is a
    // different thing from two records sharing one response.
    if (raw.uuid) {
      if (seenRecordUuids.has(raw.uuid)) continue
      seenRecordUuids.add(raw.uuid)
    }

    const usage = raw.message?.usage as RawUsage | undefined
    if (!usage) continue

    const entry = toEntry(raw, usage, source, filePath, pricingTable)
    if (!entry) continue

    const existing = byResponseId.get(entry.responseId)
    if (!existing) {
      byResponseId.set(entry.responseId, entry)
      continue
    }

    // Merge, rather than pick. Streaming transcripts — every subagent file in
    // measured history, 5,780 of 24,649 responses — emit provisional records
    // whose output_tokens is a placeholder (1, 2, 3) with a null stop_reason,
    // followed by a final record carrying the real count. Output only ever
    // grows, so the largest is the completed one; taking the first would
    // undercount subagent output by orders of magnitude.
    existing.snapshotCount++
    if (entry.outputTokens > existing.outputTokens) {
      existing.outputTokens = entry.outputTokens
      existing.thinkingTokens = entry.thinkingTokens ?? existing.thinkingTokens
      existing.costUsd = entry.costUsd
      existing.iterationsRaw = entry.iterationsRaw ?? existing.iterationsRaw
    }
    if (stableUsageFingerprint(existing) !== stableUsageFingerprint(entry)) {
      existing.usageConflict = true
    }
  }

  return { entries: [...byResponseId.values()], malformedLines }
}
