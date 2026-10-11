import type { ModelFamily } from '@shared/types/pricing'
import { getModelFamily } from './models'

// ─── Context window per model ─────────────────────────────────────────────────
// Transcripts record the model but never the window it ran with, so the window
// is read from the model family:
//
// - `1m`: Claude Code runs the model on its full 1M window. Checked against
//   real sessions: Opus 5 / 5.5 auto-compact at ~967K and Fable 5 at 1000K.
// - `200k`: the model has no larger window to offer.
// - `200k-or-1m`: 1M exists but is opt-in (`opus[1m]` and the like), and the
//   transcript does not say which one the session chose. 200K is assumed until
//   the session's own context goes past it, which only a 1M window allows.
//
// A `Record` over every family, so adding a family without deciding its
// window does not compile.

type WindowRule = '1m' | '200k' | '200k-or-1m'

const WINDOW_RULES: Record<ModelFamily, WindowRule> = {
  'fable-5-1': '1m',
  'mythos-5-1': '1m',
  'fable-5': '1m',
  'mythos-5': '1m',
  'opus-5-5': '1m',
  'opus-5': '1m',
  'sonnet-5-5': '1m',
  'sonnet-5': '1m',
  'haiku-5-5': '1m',
  'opus-4-8': '200k-or-1m',
  'opus-4-7': '200k-or-1m',
  'opus-4-6': '200k-or-1m',
  'sonnet-4-6': '200k-or-1m',
  'sonnet-4-5': '200k-or-1m',
  'sonnet-4': '200k-or-1m',
  'opus-4-5': '200k',
  'opus-4-1': '200k',
  'opus-4': '200k',
  'haiku-4-5': '200k',
  'haiku-3-5': '200k',
  unknown: '200k-or-1m',
}

const SMALL = 200_000
const LARGE = 1_000_000

export interface ContextWindow {
  tokens: number
  /** True when the transcript cannot tell which window the session ran with. */
  estimated: boolean
}

/**
 * The context window `model` ran with, given the largest context the session
 * has sent on that model so far.
 */
export function contextWindowFor(
  model: string | null | undefined,
  peakContextTokens: number
): ContextWindow {
  switch (WINDOW_RULES[getModelFamily(model)]) {
    case '1m':
      return { tokens: LARGE, estimated: false }
    case '200k':
      return { tokens: SMALL, estimated: false }
    case '200k-or-1m':
      return { tokens: peakContextTokens > SMALL ? LARGE : SMALL, estimated: true }
  }
}
