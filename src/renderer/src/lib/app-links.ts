// Renderer-side build-time config. VITE_* vars are injected automatically by Vite.

/**
 * The public links, used when the build was not given `VITE_WEBSITE_URL` or
 * `VITE_REPO_URL` (a dev checkout with no `.env`, or a release built without
 * the secrets). These are public URLs, not secrets, so a sensible default
 * beats an About page that throws on `undefined.replace`.
 */
export const DEFAULT_WEBSITE_URL = 'https://claudewatch.mohamedalimay.dev'
export const DEFAULT_REPO_URL = 'https://github.com/maydali28/claudewatch'

/** `value` with any trailing slash removed, or `fallback` when it is missing or blank. */
export function linkOrDefault(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim()
  return trimmed ? trimmed.replace(/\/+$/, '') : fallback
}

const repo = linkOrDefault(import.meta.env.VITE_REPO_URL, DEFAULT_REPO_URL)

export const AppLinks = {
  /** Project website URL shown in About panels. */
  website: linkOrDefault(import.meta.env.VITE_WEBSITE_URL, DEFAULT_WEBSITE_URL),

  /** GitHub repository URL shown in About panels. */
  repo,

  /** Releases page — where platforms without an in-app installer get the package. */
  releases: `${repo}/releases`,
} as const
