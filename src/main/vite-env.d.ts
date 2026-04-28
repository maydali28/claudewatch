// Type declarations for MAIN_VITE_* variables loaded by electron-vite.
declare namespace NodeJS {
  interface ProcessEnv {
    readonly MAIN_VITE_SENTRY_DSN?: string
    readonly MAIN_VITE_RELEASE_SERVER_URL?: string
    readonly MAIN_VITE_GITHUB_RELEASES_URL?: string
    readonly MAIN_VITE_BREW_CASK_NAME?: string
  }
}
