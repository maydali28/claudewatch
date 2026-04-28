// ─── Feature Flags ────────────────────────────────────────────────────────────
//
// Each flag below gates an in-progress feature. Setting a flag to `true` opts
// the local build into the corresponding UI surface. CI builds ship with the
// defaults below until each feature reaches general availability.
//
// Roadmap (anticipated GA):
//   - timeline       → 0.12 (project-wide event stream view)
//   - lint           → 0.13 (health gauge + 45 rule runner — backend ready, UI polish pending)
//   - costAlerts     → 0.14 (threshold notifications, requires daily-cost watcher)
//   - sessionExport  → 0.11 (Markdown / JSON export from the session header)
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
