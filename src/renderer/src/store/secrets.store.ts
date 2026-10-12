import { create } from 'zustand'
import type { SecretFindingRecord, SecretHistoryScanResult } from '@shared/types'
import { ipc } from '@renderer/lib/ipc-client'
import { ipcCall } from '@renderer/lib/ipc-call'

interface SecretsState {
  findings: SecretFindingRecord[]
  isLoaded: boolean
  isScanning: boolean
  lastScan: SecretHistoryScanResult | null
  load(): Promise<void>
  /** New findings pushed by main; merged in by id. */
  addFound(found: SecretFindingRecord[]): void
  dismiss(ids: string[]): Promise<void>
  scanHistory(): Promise<SecretHistoryScanResult | null>
}

export const useSecretsStore = create<SecretsState>((set, get) => ({
  findings: [],
  isLoaded: false,
  isScanning: false,
  lastScan: null,

  async load() {
    const result = await ipcCall(() => ipc.secrets.list(), { silent: true })
    if (result.ok) set({ findings: result.data, isLoaded: true })
  },

  addFound(found) {
    const known = new Set(get().findings.map((f) => f.id))
    const fresh = found.filter((f) => !known.has(f.id))
    if (fresh.length > 0) set({ findings: [...get().findings, ...fresh] })
  },

  async dismiss(ids) {
    const prev = get().findings
    const set_ = new Set(ids)
    set({ findings: prev.map((f) => (set_.has(f.id) ? { ...f, dismissed: true } : f)) })
    const result = await ipcCall(() => ipc.secrets.dismiss(ids), {
      errorMessage: 'Could not dismiss the finding',
    })
    if (!result.ok) set({ findings: prev })
  },

  async scanHistory() {
    set({ isScanning: true })
    const result = await ipcCall(() => ipc.secrets.scanHistory(), {
      errorMessage: 'Could not scan older sessions',
    })
    set({ isScanning: false })
    if (!result.ok) return null
    set({ lastScan: result.data })
    // The new findings also arrive by push; reload so the list is complete
    // even if this window missed one.
    await get().load()
    return result.data
  },
}))
