import { contextBridge } from 'electron'
import { api } from './api'

// ─── contextIsolation hard-stop ───────────────────────────────────────────────
// Without contextIsolation, `contextBridge.exposeInMainWorld` mutates the same
// global the renderer can write back to — defeating the entire sandbox model
// and exposing Node primitives to any compromised script. Crash hard at preload
// load if a future BrowserWindow ever forgets `contextIsolation: true`, instead
// of silently downgrading the security boundary.
if (!process.contextIsolated) {
  throw new Error(
    'contextIsolation must be enabled — refusing to expose the ClaudeWatch API on a shared global'
  )
}

// Expose the typed ClaudeWatch API on window.claudewatch.
// contextIsolation: true ensures the renderer only sees what we expose here —
// no direct Node.js / Electron access from the renderer sandbox.
contextBridge.exposeInMainWorld('claudewatch', api)
