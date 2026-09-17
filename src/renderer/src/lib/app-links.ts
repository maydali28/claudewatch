// Renderer-side build-time config. VITE_* vars are injected automatically by Vite.

export const AppLinks = {
  /** Project website URL shown in About panels. */
  website: import.meta.env.VITE_WEBSITE_URL,

  /** GitHub repository URL shown in About panels. */
  repo: import.meta.env.VITE_REPO_URL,

  /** Releases page — where platforms without an in-app installer get the package. */
  releases: `${import.meta.env.VITE_REPO_URL}/releases`,
} as const
