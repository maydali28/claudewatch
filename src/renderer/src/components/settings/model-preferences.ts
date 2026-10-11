import { PRICED_FAMILIES } from '@shared/constants/pricing'
import type { ModelFamily, ModelPreference, ModelPreferences, ModelPricing } from '@shared/types'

type PricedFamily = Exclude<ModelFamily, 'unknown'>

// Longest first, so `opus-4-5` is tried before `opus-4`.
const BY_LENGTH = [...PRICED_FAMILIES].sort((a, b) => b.length - a.length)

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// A family name inside a longer ID, not followed by another version number:
// `sonnet-4` must not match `sonnet-4-5`, but a date (`-20250929`) or a
// suffix (`-v1`) may follow.
const PATTERNS = BY_LENGTH.map((family) => {
  const [name, ...version] = family.split('-')
  const tail = '(?![0-9]|-[0-9](?:[^0-9]|$))'
  const forms: string[] = [family]
  // The older `claude-3-5-haiku` order puts the version first.
  if (version.length > 0) forms.push(`${version.join('-')}-${name}`)
  return {
    family,
    re: new RegExp(`(?:^|[^a-z0-9])(?:${forms.map(escape).join('|')})${tail}`),
  }
})

/**
 * The family a custom model ID most likely stands for, read off its name:
 * `my-gateway/claude-sonnet-4-5-latest` → `sonnet-4-5`. A suggestion only;
 * nothing is mapped until the user accepts it. Undefined when the name says
 * nothing (a Bedrock application profile ARN, a deployment called `prod`).
 */
export function suggestModelFamily(model: string): PricedFamily | undefined {
  const normalized = model.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return PATTERNS.find((p) => p.re.test(normalized))?.family
}

function prune(pref: ModelPreference): ModelPreference | undefined {
  const next: ModelPreference = {}
  if (pref.family) next.family = pref.family
  const rates = Object.fromEntries(
    Object.entries(pref.rates ?? {}).filter(([, v]) => typeof v === 'number')
  ) as Partial<ModelPricing>
  if (Object.keys(rates).length > 0) next.rates = rates
  const name = pref.displayName?.trim()
  if (name) next.displayName = name
  return Object.keys(next).length > 0 ? next : undefined
}

/**
 * One model's preference changed, dropping whatever is left empty so the
 * stored map only holds what the user actually set.
 */
export function editModelPreference(
  prefs: ModelPreferences,
  model: string,
  edit: (current: ModelPreference) => ModelPreference
): ModelPreferences {
  const next = { ...prefs }
  const pref = prune(edit({ ...prefs[model], rates: { ...prefs[model]?.rates } }))
  if (pref) next[model] = pref
  else delete next[model]
  return next
}
