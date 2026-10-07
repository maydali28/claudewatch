// ─── Model Pricing (prices per million tokens) ────────────────────────────────

export interface ModelPricing {
  input: number
  output: number
  cacheRead: number
  cache5m: number
  cache1h: number
}

// ─── Providers ────────────────────────────────────────────────────────────────

export type PricingProvider = 'anthropic'

export type ModelFamily =
  // Fable 5.1 / Mythos 5.1 — $10/$50, cache reads flat $0.25
  | 'fable-5-1'
  | 'mythos-5-1'
  // Fable 5 / Mythos 5 — $10/$50
  | 'fable-5'
  | 'mythos-5'
  // Opus 5.5 — $4/$20, cache reads 0.05x ($0.20)
  | 'opus-5-5'
  // Opus 5 — $5/$25
  | 'opus-5'
  // Opus 4.8 / 4.7 / 4.6 / 4.5 — $5/$25
  | 'opus-4-8'
  | 'opus-4-7'
  | 'opus-4-6'
  | 'opus-4-5'
  // Opus 4.1 / 4 — $15/$75
  | 'opus-4-1'
  | 'opus-4'
  // Sonnet 5.5 / 5 — $2/$10
  | 'sonnet-5-5'
  | 'sonnet-5'
  // Sonnet 4.6 / 4.5 / 4 — $3/$15
  | 'sonnet-4-6'
  | 'sonnet-4-5'
  | 'sonnet-4'
  // Haiku 4.5 — $1/$5
  | 'haiku-4-5'
  // Haiku 3.5 — $0.80/$4
  | 'haiku-3-5'
  | 'unknown'

// ─── Model preferences ────────────────────────────────────────────────────────

/**
 * What the user said about one exact model ID (a gateway alias, a Bedrock
 * ARN, a Foundry deployment name, …): which family it is, rates of its own,
 * and the name to show for it. Every field is optional.
 */
export interface ModelPreference {
  family?: ModelFamily
  rates?: Partial<ModelPricing>
  displayName?: string
}

/** Keyed by the exact model ID as transcripts write it. */
export type ModelPreferences = Record<string, ModelPreference>

/** The rates one exact model ID is priced at, and the family it counts as. */
export interface ModelRate extends ModelPricing {
  family: ModelFamily
}

/**
 * The active pricing table: rates per family, plus one `model:<id>` entry for
 * each model ID the user mapped or priced. The per-model entries travel in the
 * same object so everything the table already reaches (the accounting worker,
 * the caches' pricing fingerprint, IPC) carries them without a second argument.
 */
export type PricingTable = Record<ModelFamily, ModelPricing> &
  Partial<Record<`model:${string}`, ModelRate>>

/** A model seen in the transcripts, for Settings › Models. */
export interface SeenModel {
  model: string
  /** The family it resolves to under the current preferences. */
  family: ModelFamily
  responses: number
  /** Responses that could not be priced. */
  unpricedResponses: number
  /** Last local day it was used, `YYYY-MM-DD`. */
  lastDay: string
}
