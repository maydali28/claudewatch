import type { ClaudeWatchAPI } from '@preload/api'

// Typed accessor for the preload bridge exposed via contextBridge.
// `window.claudewatch` is populated by src/preload/index.ts in Electron; outside
// Electron (vitest/jsdom) it is undefined and we throw on first access. The
// global type declaration lives in src/renderer/src/vite-env.d.ts so every
// renderer file sees the same shape.

function getClaudeWatchApi(): ClaudeWatchAPI {
  if (typeof window === 'undefined' || !window.claudewatch) {
    throw new Error('window.claudewatch is not available — are you running outside Electron?')
  }
  return window.claudewatch
}

export const ipc: ClaudeWatchAPI = new Proxy({} as ClaudeWatchAPI, {
  get(_target, propertyName: string) {
    return getClaudeWatchApi()[propertyName as keyof ClaudeWatchAPI]
  },
})
