// ─── Feature Flags ────────────────────────────────────────────────────────────
//
// Each flag below gates an in-progress feature. Setting a flag to `true` opts
// the local build into the corresponding UI surface. CI builds ship with the
// defaults below until each feature reaches general availability.
//
// Targets: costAlerts → 1.7. See docs/ROADMAP.md.
//
// Removing a flag from this file should happen in lockstep with making the
// gated UI unconditional. Don't leave dead flags behind.

export interface FeatureFlags {
  /** Show cost alert settings (backend not yet implemented). Coming in 0.14. */
  costAlerts: boolean
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  costAlerts: false,
}
