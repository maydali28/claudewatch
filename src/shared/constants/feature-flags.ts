// ─── Feature Flags ────────────────────────────────────────────────────────────
//
// Each flag below gates an in-progress feature. Setting a flag to `true` opts
// the local build into the corresponding UI surface. CI builds ship with the
// defaults below until each feature reaches general availability.
//
// No feature is behind a flag right now. See docs/ROADMAP.md.
//
// Removing a flag from this file should happen in lockstep with making the
// gated UI unconditional. Don't leave dead flags behind.

// Empty until the next feature needs a flag: add `name: boolean` here and its default below.
export type FeatureFlags = Record<never, boolean>

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {}
