// All build-time config values in one place.
// electron-vite loads MAIN_VITE_* vars from .env / .env.local and injects
// them into the main process bundle via import.meta.env at build time,
// and into process.env in dev mode.

export const AppConfig = {
  /** Sentry DSN for crash reports and user feedback. Empty string = Sentry disabled. */
  sentryDsn: process.env.MAIN_VITE_SENTRY_DSN ?? '',

  /** Base URL for the auto-updater release feed. Empty string = updates disabled. */
  releaseServerUrl: process.env.MAIN_VITE_RELEASE_SERVER_URL ?? '',

  /** GitHub releases base URL for fetching release manifests. */
  githubReleasesUrl: process.env.MAIN_VITE_GITHUB_RELEASES_URL ?? '',

  /** Homebrew cask name used in the `brew upgrade --cask <name>` command. */
  brewCaskName: process.env.MAIN_VITE_BREW_CASK_NAME ?? '',
} as const
