import type { ModelFamily } from './pricing'

// ─── Record Types ─────────────────────────────────────────────────────────────

export type RecordType =
  | 'user'
  | 'assistant'
  | 'tool_result'
  | 'system'
  | 'summary'
  | 'result'
  | 'file-history-snapshot'
  | 'progress'
  | 'ai-title'
  | 'attachment'

// ─── Token Usage ──────────────────────────────────────────────────────────────

export interface CacheCreationBreakdown {
  ephemeral5mInputTokens?: number
  ephemeral1hInputTokens?: number
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  cacheCreation?: CacheCreationBreakdown
}

// ─── Content Blocks ───────────────────────────────────────────────────────────

export type AnyCodableValue =
  string | number | boolean | null | AnyCodableValue[] | { [key: string]: AnyCodableValue }

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ThinkingBlock {
  type: 'thinking'
  thinking: string
}

export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  toolName: string
  input: Record<string, AnyCodableValue>
}

export interface ToolResultBlock {
  type: 'tool_result'
  toolUseId: string
  content: string
  isError: boolean
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock

// ─── Raw JSONL Record (lenient decoding) ──────────────────────────────────────

export interface RawContentBlock {
  type?: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: Record<string, AnyCodableValue>
  tool_use_id?: string
  content?: string | Array<{ type: string; text: string }>
  is_error?: boolean
}

export interface RawMessage {
  role?: string
  content?: string | RawContentBlock[]
  id?: string
  model?: string
  stop_reason?: string
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
    cache_creation?: {
      ephemeral_5m_input_tokens?: number
      ephemeral_1h_input_tokens?: number
    }
  }
}

export interface RawRecord {
  type?: RecordType
  uuid?: string
  parentUuid?: string
  timestamp?: string
  sessionId?: string
  cwd?: string
  slug?: string
  /**
   * The session name Claude Code generates from the first exchange, carried
   * on `type: 'ai-title'` records (no `uuid`, no `timestamp`). Re-emitted on
   * later writes with the same text; the last one seen wins.
   */
  aiTitle?: string
  /**
   * `'bg'` on every record of a session Claude Code moved to the background.
   * See `SessionSummary.isBackground`.
   */
  sessionKind?: string
  /**
   * The payload of a `type: 'attachment'` record: context Claude Code adds to
   * a session (the skill listing, environment, hook output, …). Only the
   * `skill_listing` kind is read, by `parsers/skill-listing.ts`.
   */
  attachment?: { type?: unknown; [key: string]: unknown }
  message?: RawMessage
  subtype?: string
  content?: string
  isCompactSummary?: boolean
  /** Injected context (a skill body, an image caption, a command caveat) that rides alongside a real prompt; never answered on its own. */
  isMeta?: boolean
  isVisibleInTranscriptOnly?: boolean
  toolUseResult?: {
    type?: string
    content?: string | Array<{ type: string; text: string }>
    is_error?: boolean
    /** Agent tool results only: the sub-agent this result belongs to. */
    agentId?: string
    /** Agent tool results only: `completed`, or `async_launched` for a background agent. */
    status?: string
    /** Agent tool results only: how long a foreground sub-agent ran. */
    totalDurationMs?: number
  }
  logicalParentUuid?: string
  compactMetadata?: {
    preTokens?: number
    timestamp?: string
  }
  /**
   * Effort level recorded by Claude Code for this turn. Distinct from the
   * effort the app infers from output length — this is what was configured,
   * not what we guessed. Unfamiliar values are preserved as written.
   */
  effort?: string
  /** Present on newer records; useful for provenance and reconciliation. */
  requestId?: string
  /**
   * Who wrote a `type: 'user'` record, on recent Claude Code versions only —
   * and not on every record even then. Observed kinds: `human` (a prompt),
   * `task-notification` (a background task finished), `peer` (a sub-agent
   * hand-back; `from` is the agent id, `handback` is set) and, in sub-agent
   * transcripts, `coordinator`. Other fields Claude Code writes (`body`, …)
   * are not read. See `classifyUserRecord`.
   */
  origin?: {
    kind?: string
    from?: string
    senderTaskId?: string
    handback?: boolean
  }
}

/**
 * What a `type: 'user'` record is. Only `prompt` is something a person wrote;
 * everything else is written by Claude Code. Decided by `classifyUserRecord`
 * in `src/main/services/parsers/parser-helpers.ts`.
 *
 * In a sub-agent transcript, the opening prompt is written by the parent
 * agent with no `origin`; it counts as `'prompt'` (the sub-agent's user
 * message). Mid-task coordinator notes (`origin.kind: 'coordinator'`,
 * `isMeta`) are `'meta'`.
 */
export type UserRecordKind =
  /** A person wrote it: counts as a user message, shown as the user's bubble. */
  | 'prompt'
  /** Carries tool_result blocks only. */
  | 'tool-result'
  /** A background task finished. */
  | 'task-notification'
  /** A sub-agent or peer session handed back a report. */
  | 'agent-message'
  /** Injected context: a skill body, an image caption, a coordinator note. */
  | 'meta'
  /** A local slash command, its output or its caveat — never sent to the model. */
  | 'local-command'
  /** The "[Request interrupted by user…" marker. */
  | 'interrupt'
  /** A compaction summary. */
  | 'compact-summary'

// ─── Parsed Record (clean, typed) ─────────────────────────────────────────────

export interface ParsedRecord {
  type: RecordType
  uuid: string
  parentUuid?: string
  timestamp?: string
  sessionId?: string
  cwd?: string
  slug?: string
  role?: 'user' | 'assistant' | 'system'
  model?: string
  stopReason?: string
  usage?: TokenUsage
  contentBlocks: ContentBlock[]
  isCompactionBoundary: boolean
  compactionPreTokens?: number
  /**
   * The API response this record belongs to — `message.id`, or a
   * `uuid:<record uuid>` fallback when the response carries no id (see
   * `assistantResponseId`). Only set for non-synthetic assistant records:
   * Claude Code writes one response as several records (thinking, text, each
   * tool_use) that all share this id and all repeat that response's full
   * usage, which is exactly what lets a consumer (e.g. the CSV export)
   * recognise a repeat and avoid re-summing it. Undefined for user/system
   * records, which are not API responses.
   */
  responseId?: string
  /**
   * What kind of user record this is. Set on every `type: 'user'` record;
   * undefined on other records. A consumer must treat undefined on a user
   * record as `'prompt'`.
   */
  userKind?: UserRecordKind
  /** The sub-agent that sent an `'agent-message'` record (`origin.from`), when known. */
  originAgentId?: string
  /**
   * A prompt the person sent while Claude was busy, written by Claude Code as
   * a `queued_command` attachment (see `promoteQueuedPrompt`). In a sub-agent
   * transcript this is a message sent to the running agent directly.
   */
  queued?: boolean
}

// ─── Tool Result Map ───────────────────────────────────────────────────────────

export interface ToolResultEntry {
  content: string
  isError: boolean
}

// ─── Observability ────────────────────────────────────────────────────────────

export type EffortLevel = 'low' | 'medium' | 'high' | 'ultrathink'

export type ErrorClassification =
  | 'rateLimit'
  | 'authFailure'
  | 'proxyError'
  | 'maxTokensTruncation'
  | 'missingToolResult'
  | 'abruptEnding'
  | 'toolError'
  | 'unknown'

export interface TurnDuration {
  turnIndex: number
  prevTimestamp?: string
  assistantTimestamp?: string
  durationMs: number
  isPostCompaction: boolean
  inputTokens: number
  model?: string
}

export interface EffortDistribution {
  low: number
  medium: number
  high: number
  ultrathink: number
}

export interface SessionErrorDetail {
  classification: ErrorClassification
  turnIndex: number
  timestamp?: string
  message: string
}

export interface CompactionEvent {
  index: number
  timestamp?: string
  preTokens?: number
  turnsSinceLastCompaction: number
}

export interface ParallelToolGroup {
  turnIndex: number
  timestamp?: string
  toolNames: string[]
  toolCount: number
}

export interface SessionObservability {
  medianTurnDurationMs?: number
  maxTurnDurationMs?: number
  dominantEffortLevel?: EffortLevel
  effortDistribution: EffortDistribution
  errorClassifications: ErrorClassification[]
  hasIdleZombieGap: boolean
  estimatedIdleWasteCost: number
  compactionTimestamps: string[]
  parallelToolCallCount: number
  maxParallelDegree: number
  isWorktreeSession: boolean
}

// ─── Model Token Breakdown (per-session, per-model) ───────────────────────────

export interface ModelTokenBreakdown {
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreation5mTokens: number
  cacheCreation1hTokens: number
  /**
   * Remainder of this model's cache-write total that neither tier explains —
   * a flat `cache_creation_input_tokens` reported with no TTL split. Priced
   * at the 5-minute rate as a fallback estimate (see `cacheWriteUnknownTtl`
   * in `ledger.ts`), but reported separately so it is never mistaken for a
   * known 5-minute write — the same split-quantity bug class fixed on
   * `SessionDayModelUsage.cacheCreationUnknownTtlTokens`. The two known tiers
   * above plus this field always equal the effective write total the cost
   * was actually computed from.
   */
  cacheCreationUnknownTtlTokens: number
  estimatedCost: number
  turnCount: number
}

// ─── Subagent Summary ─────────────────────────────────────────────────────────

export interface SubagentSummary {
  agentId: string
  /** `agentType` from the sub-agent's `agent-<id>.meta.json` (`general-purpose`, `Explore`, …). */
  agentType?: string
  /**
   * The task description the parent gave the sub-agent, from its meta file.
   * Sub-agent transcripts carry no `ai-title` record, so this is the closest
   * thing to a title.
   */
  description?: string
  /** The parent's Agent tool call that started this sub-agent. */
  toolUseId?: string
  /** Set when another sub-agent, not the session itself, started this one. */
  parentAgentId?: string
  /** 1 for a sub-agent of the session, 2 for a sub-agent of a sub-agent, … */
  spawnDepth?: number
  /** Started in the background: the parent did not wait for it. */
  isBackground?: boolean
  /**
   * How long the sub-agent ran. `reported` is Claude Code's own figure (the
   * Agent tool result's `totalDurationMs`, or a background agent's
   * task-notification `duration_ms`); `span` is last minus first timestamp,
   * which overstates an agent that was resumed later.
   */
  durationMs?: number
  durationSource?: 'reported' | 'span'
  /**
   * When the parent last saw this sub-agent stop: its Agent tool result, or
   * for a background agent its latest task notification. Absent while it is
   * running, and for a sub-agent whose end was never recorded. Read with
   * `isSubagentRunning`.
   */
  stoppedAt?: string
  messageCount: number
  totalInputTokens: number
  totalOutputTokens: number
  primaryModel?: string
  firstTimestamp: string
  lastTimestamp: string
  estimatedCost: number
  modelBreakdown: ModelTokenBreakdown[]
}

// ─── Per-day usage ────────────────────────────────────────────────────────────

/**
 * Usage attributed to the calendar day it actually occurred on, derived from
 * each response's own timestamp.
 *
 * Analytics previously bucketed a session's entire lifetime on its last active
 * day, so resuming yesterday's session today moved yesterday's tokens — and
 * yesterday's models — into today. Carrying the split on the summary lets the
 * dashboard answer date-scoped questions without re-reading transcripts.
 */
export interface SessionDayModelUsage {
  /** Exact model string as written. */
  model: string
  family: ModelFamily
  inputTokens: number
  outputTokens: number
  /** Needed to price cache savings at this model's own rate, not a proxy's. */
  cacheReadTokens: number
  cacheCreation5mTokens: number
  cacheCreation1hTokens: number
  /**
   * Remainder of this model's cache-write total that neither tier explains —
   * a flat `cache_creation_input_tokens` reported with no TTL split. Priced
   * at the 5-minute rate as a fallback estimate, but reported separately so
   * it is never mistaken for a known 5-minute write.
   */
  cacheCreationUnknownTtlTokens: number
  /**
   * Null when this exact model could not be priced — never coerced to 0.
   * A real zero (a priced model this day genuinely cost nothing) and an
   * unpriced model both look like "$0.00" if collapsed together, which is
   * exactly how Opus 5 was billed at a stranger's rate without anything
   * appearing wrong. Consumers must skip null rows when summing rather than
   * adding a zero.
   */
  estimatedCost: number | null
  turnCount: number
}

export interface SessionDayUsage {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreation5mTokens: number
  cacheCreation1hTokens: number
  cacheCreationTokens: number
  /** Sum of priced responses only; see `unpricedResponses` for what it excludes. */
  estimatedCost: number
  /** Responses on this day whose model could not be priced, excluded from `estimatedCost`. */
  unpricedResponses: number
  /**
   * Responses on this day whose usage shape was unreadable or self-
   * contradictory — a tier/flat mismatch, a multi-iteration array, or a
   * missing/invalid counter. Tokens and cost are still counted; this is
   * "partially observed", not a filter. See `SessionDiagnostics.incompleteUsageResponses`.
   */
  incompleteUsageResponses: number
  /**
   * Responses on this day where no snapshot ever reported a completion
   * signal — the retained output figure is the maximum observed across
   * snapshots, not a reported final count. Provenance, not an error. See
   * `SessionDiagnostics.responsesWithoutCompletionSignal`.
   */
  responsesWithoutCompletionSignal: number
  /**
   * Responses on this day with no `message.id`, identified by record uuid
   * instead. See `SessionDiagnostics.reducedConfidenceResponses`.
   */
  reducedConfidenceResponses: number
  /**
   * Responses on this day that used fast mode, regional inference or a
   * non-standard service tier. See `SessionDiagnostics.pricingModifierResponses`.
   */
  pricingModifierResponses: number
  /**
   * Web search / web fetch requests on this day. See
   * `SessionDiagnostics.serverToolRequests`.
   */
  serverToolRequests: number
  /** Billable API responses on this day. */
  responseCount: number
  /** Parent-transcript messages on this day. */
  parentMessageCount: number
  /** Subagent messages on this day. */
  childMessageCount: number
  /**
   * Messages on this day, parent and subagents combined. Always equal to
   * `parentMessageCount + childMessageCount`, and the per-day rows always sum
   * to `SessionSummary.messageCount`.
   */
  messageCount: number
  /**
   * Parent-only cost. Effort is recorded for parent turns, so attributing
   * effort cost needs the parent's share rather than the combined figure.
   */
  parentEstimatedCost: number
  /** Compaction events that happened on this day. */
  compactions: number
  /** Context tokens cleared by those compactions. */
  tokensRemovedByCompaction: number
  /**
   * Largest pre-compaction context of any single event on this day. A rollup
   * that needs the true peak across a range must take `Math.max` over this
   * field across days — summing (or averaging) per-day figures collapses
   * distinct events and cannot recover it.
   */
  maxPreCompactionTokens: number
  /** Effort votes cast by responses flushed on this day. */
  effortDistribution: EffortDistribution
  /** Responses on this day that issued 2+ tool calls in one turn. */
  parallelToolGroups: number
  /**
   * Largest parallel-tool degree seen on this day. A rollup that needs the
   * true peak across a range must take `Math.max` over this field across
   * days, the same way `maxPreCompactionTokens` does — summing would not be
   * a peak.
   */
  maxParallelDegree: number
  models: SessionDayModelUsage[]
}

// ─── Session Summary (lightweight, for sidebar) ───────────────────────────────

/** A skill Claude Code listed as available in a session. */
export interface SkillListingEntry {
  name: string
  description?: string
}

export interface ContextFill {
  tokens: number
  window: number
  /** True when the transcript cannot tell a 200K window from a 1M one. */
  windowEstimated: boolean
}

export interface SessionSummary {
  id: string
  projectId: string
  projectPath: string
  slug?: string
  title: string
  /**
   * Every skill the session's `skill_listing` records named, in first-seen
   * order; absent when it recorded none. The Skills panel's only source for
   * skills with no file on disk (built-in, claude.ai). Added in metadata
   * cache v14.
   */
  skillListing?: SkillListingEntry[]
  firstTimestamp: string
  lastTimestamp: string
  /**
   * True while the last turn is still in progress at the end of the
   * transcript: a tool call waiting for its result, or a user record the
   * assistant has not answered yet. Feeds `isSessionLive` so a session stays
   * live through a long silent tool run. Required: `metadata-parser.ts` is
   * the only producer, and the metadata cache's version bump (v10) discards
   * every entry written before the field existed.
   */
  turnOpen: boolean
  messageCount: number // parent + subagent messages combined
  parentMessageCount: number // parent session messages only (matches session details panel)
  /**
   * Model of the most recent *parent* response. This is what a live badge
   * should show: switching model mid-session updates it immediately, and a
   * subagent on another model never replaces it.
   */
  latestModel?: string
  /** Parent model with the most responses across the session's life. */
  dominantModel?: string
  /**
   * How full the context window is now: what the latest parent response sent,
   * against the window of the model it ran on (`contextWindowFor`). Absent
   * until the session has a response.
   */
  contextFill?: ContextFill
  /**
   * Claude Code moved this session to the background (`sessionKind: 'bg'`).
   * It does so by copying the session so far into a new session id, so the
   * copy starts with the same messages as the session it came from and both
   * appear in the list under the same title.
   */
  isBackground?: boolean
  /**
   * Sessions this background session was copied from, hidden from the list
   * and from every total because all of their records are repeated here
   * (see `foldBackgroundContinuations`). Absent when there are none.
   */
  continuesSessionIds?: string[]
  /**
   * `uuid` of the transcript's first and last records. A background copy
   * starts with the same `firstUuid` as the session it came from, and holds
   * that session's `lastUuid` unless the session went on after the move.
   */
  firstUuid?: string
  lastUuid?: string
  /** Every exact model seen in this session, parent and subagents. */
  modelsUsed: string[]
  /** Responses whose model is unrecognised and therefore excluded from cost. */
  unpricedResponses: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheCreationTokens: number
  totalCacheCreation5mTokens: number
  totalCacheCreation1hTokens: number
  compactionCount: number
  totalTokensRemovedByCompaction: number // sum of preTokens across all compaction events
  turnDurations: TurnDuration[]
  estimatedCost: number
  hasError: boolean
  toolCallCount: number
  observability: SessionObservability
  tags?: string[]
  subagents: SubagentSummary[]
  /**
   * Usage split by the day it happened, parent and subagents combined. Every
   * date-scoped figure in analytics is derived from this rather than from the
   * session's last timestamp.
   */
  dailyUsage: SessionDayUsage[]
  /**
   * Bad input this session's parse encountered and could not simply absorb.
   * All four are "we know this happened but not what it was" counts, not
   * estimates: a transcript line that failed to parse, a subagent transcript
   * that failed to read, a raw usage counter rejected for being negative
   * (see `ledger.ts`'s `num()`), and a merge disagreement between repeated
   * snapshots of the same response. Zero on real history is the expected
   * state — this exists so a regression shows up instead of being silently
   * absorbed.
   */
  diagnostics: SessionDiagnostics
  /**
   * Combined parent + subagent total, a SUBSET of `totalOutputTokens` — see
   * `UsageTotals.thinkingTokens`. Zero when nothing in this session reported
   * it, which is the common case for transcripts predating the field.
   */
  thinkingTokens: number
  /**
   * Effort as Claude Code itself recorded it, keyed by the exact string
   * reported and combined across parent and subagent responses — see
   * `UsageProjection.recordedEffortDistribution` for why this must stay
   * distinct from `observability.effortDistribution` (inferred, four fixed
   * buckets) rather than merged with or falling back to it.
   */
  recordedEffortDistribution: Record<string, number>
  /** Distinct `service_tier` values reported across this session's responses. */
  serviceTiers: string[]
  /**
   * Tool calls per day, tool and side (parent or sub-agents). Feeds the
   * session's Tools tab and the Analytics Tools tab. Added in metadata cache v15.
   */
  toolUsage: ToolUsageRow[]
}

/**
 * See `SessionSummary.diagnostics`.
 *
 * The four fields below were previously detected by the ledger (see
 * `UsageTotals` in `projection.ts`) but went no further than a `log.warn` —
 * an exported artefact or a renderer reading this session lost the fact
 * entirely. They are four DISTINCT conditions, not interchangeable, and
 * collapsing them loses exactly the distinction each one exists to carry:
 *
 * - `unpricedResponses`: a price could not be computed (unknown model).
 * - `incompleteUsageResponses`: the usage shape itself was unreadable or
 *   self-contradictory. Partially observed, not a filter.
 * - `responsesWithoutCompletionSignal`: no completion signal was ever seen;
 *   the retained output figure is the maximum observed across snapshots, not
 *   a reported final count. Provenance, not an error.
 * - `reducedConfidenceResponses`: no `message.id`; identity fell back to the
 *   record uuid.
 */
export interface SessionDiagnostics {
  malformedLines: number
  unreadableChildren: number
  negativeCounters: number
  /** Responses whose repeated snapshots disagreed in a non-output field — see `ResponseEntry.usageConflict`. */
  conflictCount: number
  /**
   * Responses whose model could not be priced — see `UsageTotals.unpricedResponses`.
   * Their tokens are still counted; this is coverage, not a filter.
   */
  unpricedResponses: number
  /**
   * Responses whose usage shape the ledger cannot price with confidence: a
   * tier/flat mismatch, a multi-iteration array, or a missing/invalid
   * counter — see `ResponseEntry.usageIncomplete`. Tokens and cost are still
   * counted; this is "partially observed", not a filter.
   */
  incompleteUsageResponses: number
  /**
   * Responses where no snapshot ever reported a non-empty `stop_reason` —
   * see `ResponseEntry.hasCompletionSignal`. NOT a tripwire for data that
   * never occurs (measured at 28% of response groups in real history), and
   * NOT a reason to treat the response as unpriceable.
   *
   * It records PROVENANCE, not a grade of confidence in the number: a
   * completion signal means a stop reason was seen on SOME snapshot, while
   * the retained `outputTokens` is the MAXIMUM across all of them. Those are
   * two different observations — a later provisional snapshot can exceed the
   * one that carried the stop reason — so the flag never certifies that the
   * output figure is final. Provenance, not an error.
   */
  responsesWithoutCompletionSignal: number
  /**
   * Responses whose id fell back to `uuid:<record uuid>` because no record
   * carried a `message.id` — see `ResponseEntry.reducedConfidenceId`. Their
   * tokens and cost are still counted; this is a provenance count, not a
   * filter.
   */
  reducedConfidenceResponses: number
  /**
   * Responses whose price would differ from the list rate — fast mode,
   * regional inference, or a non-standard service tier — see
   * `UsageTotals.pricingModifierResponses`. Still priced at the list rate and
   * counted everywhere; the estimate simply leaves the modifier out.
   */
  pricingModifierResponses: number
  /**
   * Web search / web fetch requests the API bills per request — see
   * `UsageTotals.serverToolRequests`. Not priced and never part of any cost.
   */
  serverToolRequests: number
}

// ─── Session Metadata ─────────────────────────────────────────────────────────

export interface SessionMetadata {
  firstTimestamp: string
  lastTimestamp: string
  messageCount: number
  userMessageCount: number
  assistantMessageCount: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheCreationTokens: number
  models: string[]
  compactionCount: number
  turnDurations: TurnDuration[]
  effortDistribution: EffortDistribution
  maxIdleGapSeconds: number
  idleGapAfterTimestamp?: string
  compactionEvents: CompactionEvent[]
  parallelToolGroups: ParallelToolGroup[]
  errorDetails: SessionErrorDetail[]
}

// ─── Parsed Session (full detail, for conversation view) ─────────────────────

export interface SubagentTotals {
  inputTokens: number
  outputTokens: number
  messageCount: number
  estimatedCost: number
}

/**
 * One response's usage as the accounting ledger settled on it after merging
 * every snapshot Claude Code wrote for it — never a single record's raw,
 * possibly-provisional `message.usage`.
 *
 * Exists because a streamed response is written as several JSONL records
 * that carry DIFFERENT usage: a provisional snapshot (`output_tokens: 1`,
 * no `stop_reason` yet) followed by the final record with the real count.
 * `export-service.ts` used to read usage off whichever record happened to
 * be first, which for a streamed response is the placeholder — see
 * `ParsedSession.responseUsage`'s own comment for the numbers. This shape
 * carries the number every other resolved total (`SessionMetadata.total*`,
 * `SubagentSummary`, the analytics ledger) is already built from, so a
 * consumer keyed on `responseId` gets the same truth rather than a fifth
 * re-derivation of it.
 *
 * `cacheCreationTokens` is the EFFECTIVE write volume — `cacheWriteFlat`, or
 * the TTL-tier sum when the tiers report more than the flat counter (see
 * `effectiveCacheWriteTotal` in `ledger.ts`) — the same quantity `costUsd`
 * was priced from, not the raw flat counter alone.
 *
 * `costUsd` is `null` exactly when the response's model could not be priced
 * (see `ResponseEntry.costUsd`) — never coerced to `0`, which would read as
 * a real, free response instead of an unpriced one.
 */
export interface ResolvedResponseUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  costUsd: number | null
}

export interface ParsedSession {
  id: string
  projectId: string
  slug?: string
  records: ParsedRecord[]
  toolResultMap: Record<string, ToolResultEntry>
  metadata: SessionMetadata
  parentSessionId?: string
  isSubagent: boolean
  subagentTotals: SubagentTotals
  /**
   * Same rationale as `SessionSummary.diagnostics`: bad input this parse
   * encountered and could not simply absorb. Carried on the full parse too
   * (not just the lightweight summary) because export is a persisted,
   * shareable artefact — unlike the on-screen views, which the same parse
   * warning also reaches through the log, an exported file has no other way
   * to disclose that data was dropped.
   */
  diagnostics: SessionDiagnostics
  /**
   * Every PARENT-transcript response's merged, ledger-resolved usage, keyed
   * by `responseId` (`message.id`, or a `uuid:` fallback — see
   * `assistantResponseId`). Populated in `full-parser.ts` straight from the
   * same ledger entries `SessionMetadata.total*` is summed from — never a
   * copy re-derived from raw records.
   *
   * This is the fix for a real defect: `export-service.ts`'s CSV used to
   * stamp a response's usage from whichever RECORD happened to be first, and
   * for a streamed response the first record is a provisional snapshot
   * (`output_tokens: 1`) while the final record — left with an EMPTY token
   * cell, since usage is written once per response — carries the real count
   * (`output_tokens: 100`). Measured prevalence: 5,780 of 24,661 responses
   * carry this streamed shape. Reading the RESOLVED total here instead of
   * the first snapshot fixes it: the ledger already merges every snapshot
   * and keeps the largest output count (see `ResponseEntry` in `ledger.ts`).
   *
   * Scope: PARENT transcript only, deliberately not parent+subagent
   * combined. A subagent's own resolved usage lives in its own transcript's
   * parse, not here — mirroring `SessionMetadata.total*` in this same file,
   * which (unlike `SessionSummary.total*` from `metadata-parser.ts`) is also
   * parent-only. A consumer needing the whole session's usage must add
   * `subagentTotals` explicitly, the same way the session details panel
   * already does for `metadata.totalOutputTokens`.
   */
  responseUsage: Record<string, ResolvedResponseUsage>
  /** Every dated response, parent and sub-agents, oldest first. */
  responseTimeline: ResponseTimelinePoint[]
}

// ─── Tool Call Entry (for Tools rail) ────────────────────────────────────────

export type ToolCategory = 'read' | 'write' | 'edit' | 'exec' | 'mcp' | 'other'

/**
 * Tool calls of one tool on one day, from one side of the session (the parent
 * transcript or its sub-agents). Built by `parsers/tool-usage.ts`.
 */
export interface ToolUsageRow {
  /** Local calendar day of the response that made the calls, `YYYY-MM-DD` or `UNDATED_DAY`. */
  day: string
  /** Tool name as Claude Code wrote it (`Read`, `mcp__github__get_me`, …). */
  tool: string
  /** For `mcp__<server>__<method>` tools, the server part. */
  mcpServer?: string
  source: 'parent' | 'subagent'
  calls: number
  /** Calls whose tool result was marked `is_error`. */
  errors: number
  /** Characters of tool result text returned to the model. */
  resultChars: number
  /**
   * Estimated cost of the responses that made these calls, a response's cost
   * split evenly across the tool calls it made. Unpriced responses add 0.
   */
  costUsd: number
}

/**
 * One API response on the session's timeline: the parent's and every
 * sub-agent's, from the ledger. Built by `full-parser.ts`.
 */
export interface ResponseTimelinePoint {
  timestamp: string
  source: 'parent' | 'subagent'
  agentId?: string
  model?: string
  /** Prompt size of this request: fresh input + cache read + cache write. */
  contextTokens: number
  outputTokens: number
  /** Null when the model could not be priced. */
  costUsd: number | null
}

// ─── Search ───────────────────────────────────────────────────────────────────

export interface SessionSearchResult {
  sessionId: string
  projectId: string
  sessionTitle: string
  matchCount: number
  snippets: string[]
}

// ─── Export ───────────────────────────────────────────────────────────────────

export type ExportFormat = 'json' | 'csv' | 'markdown'

/** The file is chosen in a save dialog main shows; the renderer never names a path. */
export interface ExportRequest {
  sessionId: string
  projectId: string
  format: ExportFormat
}
