import type { Result } from '@shared/ipc/contracts'
import { toast } from '@renderer/components/shared/toast-host'

interface IpcCallOptions {
  /** Suppress the automatic error toast (caller will handle the failure). */
  silent?: boolean
  /** Override the toast message — defaults to the IPC error string. */
  errorMessage?: string
}

/**
 * Wrap an IPC call so failures are automatically surfaced as a toast and the
 * narrow `Result<T>` discriminated union is returned for the caller to act
 * on. Catches both `{ ok: false }` results and thrown exceptions (e.g. the
 * preload bridge missing), giving the renderer a single failure path.
 */
export async function ipcCall<T>(
  fn: () => Promise<Result<T>>,
  options: IpcCallOptions = {}
): Promise<Result<T>> {
  try {
    const result = await fn()
    if (!result.ok && !options.silent) {
      toast(options.errorMessage ?? result.error, 'error')
    }
    return result
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (!options.silent) {
      toast(options.errorMessage ?? message, 'error')
    }
    return { ok: false, error: message, code: 'IPC_BRIDGE_FAILED' }
  }
}
