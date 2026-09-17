// ─── Feature Flags ────────────────────────────────────────────────────────────
//
// Each flag below gates an in-progress feature. Setting a flag to `true` opts
// the local build into the corresponding UI surface. CI builds ship with the
// defaults below until each feature reaches general availability.
//
// Targets: sessionExport, lint (Health), timeline → 1.6; costAlerts → 1.7. See docs/ROADMAP.md.
//
// Removing a flag from this file should happen in lockstep with making the
// gated UI unconditional. Don't leave dead flags behind.

export interface FeatureFlags {
  /** Show the Timeline tab in the left nav. Coming in 0.12. */
  timeline: boolean
  /** Show lint tab and health indicators in session list / session header. Coming in 0.13. */
  lint: boolean
  /** Show cost alert settings (backend not yet implemented). Coming in 0.14. */
  costAlerts: boolean
  /** Show the export button in the session panel header. Coming in 0.11. */
  sessionExport: boolean
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  timeline: false,
  lint: false,
  costAlerts: false,
  sessionExport: false,
}
