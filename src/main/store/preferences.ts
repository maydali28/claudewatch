import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { z } from 'zod'
import type { AppPreferences } from '@shared/types/preferences'
import { DEFAULT_PREFERENCES } from '@shared/types/preferences'
import { createLogger } from '@main/lib/logger'

const log = createLogger('Preferences')

// `electron-store` v10+ ships pure ESM. The main process is bundled to CJS by
// electron-vite (externalizeDepsPlugin), so a top-level static import would
// throw `ERR_REQUIRE_ESM` at runtime. Dynamic `import()` lets Node's loader
// resolve the ESM module from a CJS caller without changing the build target.
type ElectronStoreCtor = new <T>(opts: { name: string; defaults: T }) => {
  store: T
  set(value: Record<string, unknown>): void
  clear(): void
  path: string
}

let StoreCtor: ElectronStoreCtor | null = null
async function getStoreCtor(): Promise<ElectronStoreCtor> {
  if (StoreCtor) return StoreCtor
  const mod = (await import('electron-store')) as unknown as { default: ElectronStoreCtor }
  StoreCtor = mod.default
  return StoreCtor
}

// ─── Zod schema ───────────────────────────────────────────────────────────────

const AppPreferencesSchema = z.object({
  pricingProvider: z.enum(['anthropic', 'vertex-global', 'vertex-regional']),
  pricingRegion: z.enum(['us-east5', 'europe-west1', 'asia-southeast1']),
  pricingOverrides: z
    .record(
      z.string(),
      z.object({
        input: z.number().optional(),
        output: z.number().optional(),
        cacheRead: z.number().optional(),
        cache5m: z.number().optional(),
        cache1h: z.number().optional(),
      })
    )
    .optional()
    .default({}),
  costAlertThreshold: z.number().optional(),
  secretScanEnabled: z.boolean(),
  redactionLevel: z.enum(['none', 'mask', 'remove']),
  launchAtLogin: z.boolean(),
  trayTipDismissed: z.boolean(),
  theme: z.enum(['light', 'dark', 'system']),
  sidebarWidth: z.number(),
  windowBounds: z
    .object({
      width: z.number(),
      height: z.number(),
      x: z.number().optional(),
      y: z.number().optional(),
    })
    .optional(),
  alertedSecrets: z.array(z.string()),
  sessionTags: z.record(z.string(), z.array(z.string())).optional().default({}),
  lastSeenVersion: z.string().optional(),
  sentryEnabled: z.boolean(),
})

// ─── Store ────────────────────────────────────────────────────────────────────

type StoreSchema = AppPreferences & {
  sessionTags?: Record<string, string[]>
}

// Structural type matching what `electron-store` instances expose — kept local
// so the bundled CJS doesn't need to import any types from the ESM-only
// package at module load time.
interface ElectronStoreInstance<T> {
  store: T
  set(value: Record<string, unknown>): void
  clear(): void
  path: string
}

// Constructed inside `load()` after the dynamic import resolves. Every
// synchronous accessor below assumes `load()` has already run — that ordering
// is enforced by main/index.ts where `await Preferences.load()` precedes
// handler registration and any service that touches preferences.
let store: ElectronStoreInstance<StoreSchema> | null = null

function requireStore(): ElectronStoreInstance<StoreSchema> {
  if (!store) {
    throw new Error('Preferences accessed before Preferences.load() completed')
  }
  return store
}

// ─── Preferences singleton ────────────────────────────────────────────────────

let _loaded = false
let _cache: AppPreferences & { sessionTags?: Record<string, string[]> } = { ...DEFAULT_PREFERENCES }

function backupAndReset(reason: string): void {
  const activeStore = requireStore()
  try {
    const src = activeStore.path
    const dest = src.replace(/\.json$/, `.corrupted-${Date.now()}.json`)
    if (fs.existsSync(src)) fs.copyFileSync(src, dest)
    log.warn(`Preferences ${reason} — backed up to ${path.basename(dest)} and reset to defaults`)
  } catch (e) {
    log.error('Failed to back up corrupt preferences file:', e)
  }
  activeStore.clear()
}

export const Preferences = {
  async load(): Promise<void> {
    const ElectronStore = await getStoreCtor()
    store = new ElectronStore<StoreSchema>({
      name: 'preferences',
      defaults: { ...DEFAULT_PREFERENCES, sessionTags: {} },
    })

    try {
      const parsed = AppPreferencesSchema.safeParse(store.store)
      if (!parsed.success) {
        log.error('Preferences failed schema validation:', parsed.error.issues)
        backupAndReset('failed schema validation')
        _cache = { ...DEFAULT_PREFERENCES, sessionTags: {} }
      } else {
        _cache = {
          ...(parsed.data as AppPreferences),
          sessionTags: (parsed.data as StoreSchema).sessionTags ?? {},
        }
      }
    } catch (e) {
      log.error('Preferences load threw unexpectedly:', e)
      backupAndReset('threw on load')
      _cache = { ...DEFAULT_PREFERENCES, sessionTags: {} }
    }
    _loaded = true
  },

  get(): AppPreferences & { sessionTags?: Record<string, string[]> } {
    if (!_loaded) return { ...DEFAULT_PREFERENCES, sessionTags: {} }
    return { ..._cache }
  },

  set(patch: Partial<AppPreferences & { sessionTags?: Record<string, string[]> }>): void {
    const next = { ..._cache, ...patch }
    requireStore().set(next as unknown as Record<string, unknown>)
    _cache = next
  },

  setSessionTags(sessionId: string, tags: string[]): void {
    const existingTagsBySession = { ...(_cache.sessionTags ?? {}) }
    existingTagsBySession[sessionId] = tags
    const next = { ..._cache, sessionTags: existingTagsBySession }
    requireStore().set(next as unknown as Record<string, unknown>)
    _cache = next
  },

  reset(): void {
    requireStore().clear()
    _cache = { ...DEFAULT_PREFERENCES, sessionTags: {} }
  },

  get path(): string {
    return requireStore().path
  },

  /** Absolute path to the Electron logs directory — for "Show Logs" UI. */
  get logsPath(): string {
    return app.getPath('logs')
  },
}
