// Renderer-side build-time config. VITE_* vars are injected automatically by Vite.

export const AppLinks = {
  /** Project website URL shown in About panels. */
  website: import.meta.env.VITE_WEBSITE_URL,

  /** GitHub repository URL shown in About panels. */
  repo: import.meta.env.VITE_REPO_URL,
} as const
