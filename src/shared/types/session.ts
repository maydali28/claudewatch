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
  | string
  | number
  | boolean
  | null
  | AnyCodableValue[]
  | { [key: string]: AnyCodableValue }

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
  message?: RawMessage
  subtype?: string
  content?: string
  isCompactSummary?: boolean
  isVisibleInTranscriptOnly?: boolean
  toolUseResult?: {
    type?: string
    content?: string | Array<{ type: string; text: string }>
    is_error?: boolean
  }
  logicalParentUuid?: string
  compactMetadata?: {
    preTokens?: number
    timestamp?: string
  }
}

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
  estimatedCost: number
  turnCount: number
}

// ─── Subagent Summary ─────────────────────────────────────────────────────────

export interface SubagentSummary {
  agentId: string
  agentType?: string
  messageCount: number
  totalInputTokens: number
  totalOutputTokens: number
  primaryModel?: string
  firstTimestamp: string
  lastTimestamp: string
  estimatedCost: number
  modelBreakdown: ModelTokenBreakdown[]
}

// ─── Session Summary (lightweight, for sidebar) ───────────────────────────────

export interface SessionSummary {
  id: string
  projectId: string
  projectPath: string
  slug?: string
  title: string
  firstTimestamp: string
  lastTimestamp: string
  messageCount: number // parent + subagent messages combined
  parentMessageCount: number // parent session messages only (matches session details panel)
  primaryModel?: string
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
  modelBreakdown: ModelTokenBreakdown[]
  toolCallCount: number
  observability: SessionObservability
  tags?: string[]
  subagents: SubagentSummary[]
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
}

// ─── Tool Call Entry (for Tools rail) ────────────────────────────────────────

export type ToolCategory = 'read' | 'write' | 'edit' | 'exec' | 'mcp' | 'other'

export interface ToolCallEntry {
  id: string
  toolName: string
  category: ToolCategory
  input: Record<string, AnyCodableValue>
  primaryArg?: string
  resultContent?: string
  isError: boolean
  turnIndex: number
  sessionId: string
  timestamp?: string
  mcpServer?: string
  mcpMethod?: string
}

export interface ToolAnalytics {
  totalCalls: number
  errorCount: number
  errorRate: number
  uniqueFilesTouched: number
  callsByTool: Array<{ tool: string; count: number }>
  callsByCategory: Array<{ category: ToolCategory; count: number }>
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

export interface ExportRequest {
  sessionId: string
  projectId: string
  format: ExportFormat
  outputPath?: string
}
