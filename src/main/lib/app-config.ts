// All build-time config values in one place.
// electron-vite loads MAIN_VITE_* vars from .env / .env.local and injects
// them into the main process bundle via import.meta.env at build time,
// and into process.env in dev mode.

export const AppConfig = {
  /** Sentry DSN for crash reports and user feedback. Empty string = Sentry disabled. */
  sentryDsn: process.env.MAIN_VITE_SENTRY_DSN ?? '',

  /**
   * Hazel deployment backing the Linux update check only. It answers
   * `/update/:platform/:version` and serves no static files, so it must not be
   * used as an electron-updater feed. Empty string = Linux updates disabled.
   */
  releaseServerUrl: process.env.MAIN_VITE_RELEASE_SERVER_URL ?? '',

  /**
   * GitHub repository URL that hosts our releases, e.g.
   * `https://github.com/<owner>/<repo>/releases/download`. macOS and Windows
   * updates read `latest-mac.yml` / `latest.yml` from its GitHub Release
   * assets, so owner and repo are parsed out of this. Empty or non-GitHub =
   * macOS and Windows auto-updates disabled.
   */
  githubReleasesUrl: process.env.MAIN_VITE_GITHUB_RELEASES_URL ?? '',
} as const
