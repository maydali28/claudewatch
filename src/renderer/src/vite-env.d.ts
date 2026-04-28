/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SENTRY_DSN: string
  readonly VITE_WEBSITE_URL: string
  readonly VITE_REPO_URL: string
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface ImportMeta {
  readonly env: ImportMetaEnv
}

// ─── Preload bridge global ────────────────────────────────────────────────────
// The preload script (src/preload/index.ts) installs the typed API on
// `window.claudewatch` via contextBridge. Locking the name here — instead of
// re-declaring it ad-hoc in each consumer — keeps the renderer and preload in
// sync, and surfaces any accidental rename (e.g. `window.api`) at compile time.

import type { ClaudeWatchAPI } from '@preload/api'

declare module '*.md?raw' {
  const content: string
  export default content
}

declare global {
  interface Window {
    /**
     * Typed bridge to the main process. Only present inside Electron; call sites
     * that may run in tests/jsdom should guard with
     * `if (typeof window === 'undefined' || !window.claudewatch)`.
     */
    claudewatch: ClaudeWatchAPI
  }
}

export {}
