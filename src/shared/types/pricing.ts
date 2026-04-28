// ─── Model Pricing (prices per million tokens) ────────────────────────────────

export interface ModelPricing {
  input: number
  output: number
  cacheRead: number
  cache5m: number
  cache1h: number
}

// ─── Providers & Regions ──────────────────────────────────────────────────────

export type PricingProvider = 'anthropic' | 'vertex-global' | 'vertex-regional'

export type VertexRegion = 'us-east5' | 'europe-west1' | 'asia-southeast1'

export type ModelFamily =
  // Opus 4.7 / 4.6 / 4.5 — $5/$25
  | 'opus-4-7'
  | 'opus-4-6'
  | 'opus-4-5'
  // Opus 4.1 / 4 / 3 — $15/$75
  | 'opus-4-1'
  | 'opus-4'
  | 'opus-3'
  // Sonnet 4.6 / 4.5 / 4 / 3.7 — $3/$15
  | 'sonnet-4-6'
  | 'sonnet-4-5'
  | 'sonnet-4'
  | 'sonnet-3-7'
  // Haiku 4.5 — $1/$5
  | 'haiku-4-5'
  // Haiku 3.5 — $0.80/$4
  | 'haiku-3-5'
  // Haiku 3 — $0.25/$1.25
  | 'haiku-3'
  | 'unknown'
