import { useQuery, type UseQueryOptions } from '@tanstack/react-query'
import type { IPCContracts, IPCRequest, IPCResponse } from '@shared/ipc/contracts'
import { ipc } from '@renderer/lib/ipc-client'

type UnwrapResult<T> = T extends { ok: true; data: infer D } ? D : never

/**
 * Generic TanStack Query wrapper for IPC calls.
 * Automatically unwraps the Result<T> envelope and surfaces errors.
 */
export function useIPC<C extends keyof IPCContracts>(
  channel: C,
  request?: IPCRequest<C>,
  options?: Omit<UseQueryOptions<UnwrapResult<IPCResponse<C>>>, 'queryKey' | 'queryFn'>
) {
  return useQuery<UnwrapResult<IPCResponse<C>>>({
    queryKey: [channel, request],
    queryFn: async () => {
      // Dynamically route to the correct ipc domain method based on channel name
      const result = await invokeChannel(channel, request)
      if (!result.ok) {
        throw new Error(result.error)
      }
      return result.data as UnwrapResult<IPCResponse<C>>
    },
    ...options,
  })
}

// Route a channel string to the correct ipc.domain.method call
function invokeChannel(
  channel: string,
  request: unknown
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const [domain, action] = channel.split(':')

  switch (domain) {
    case 'sessions': {
      const sessions = ipc.sessions
      switch (action) {
        case 'list-projects':
          return sessions.listProjects() as Promise<{ ok: boolean; data?: unknown; error?: string }>
        case 'get-summary-list':
          return sessions.getSummaryList((request as { projectId: string }).projectId) as Promise<{
            ok: boolean
            data?: unknown
            error?: string
          }>
        case 'get-parsed': {
          const r = request as { sessionId: string; projectId: string }
          return sessions.getParsed(r.sessionId, r.projectId) as Promise<{
            ok: boolean
            data?: unknown
            error?: string
          }>
        }
        case 'search': {
          const r = request as { query: string; projectIds?: string[] }
          return sessions.search(r.query, r.projectIds) as Promise<{
            ok: boolean
            data?: unknown
            error?: string
          }>
        }
      }
      break
    }
    case 'analytics':
      return ipc.analytics.get(request as Parameters<typeof ipc.analytics.get>[0]) as Promise<{
        ok: boolean
        data?: unknown
        error?: string
      }>
    case 'config': {
      const config = ipc.config
      const r = request as { projectId?: string } | undefined
      switch (action) {
        case 'get-full':
          return config.getFull(r?.projectId) as Promise<{
            ok: boolean
            data?: unknown
            error?: string
          }>
        case 'get-commands':
          return config.getCommands(r?.projectId) as Promise<{
            ok: boolean
            data?: unknown
            error?: string
          }>
        case 'get-skills':
          return config.getSkills() as Promise<{ ok: boolean; data?: unknown; error?: string }>
        case 'get-mcps':
          return config.getMcps(r?.projectId) as Promise<{
            ok: boolean
            data?: unknown
            error?: string
          }>
        case 'get-memory':
          return config.getMemory(r?.projectId) as Promise<{
            ok: boolean
            data?: unknown
            error?: string
          }>
      }
      break
    }
    case 'lint': {
      switch (action) {
        case 'run':
          return ipc.lint.run(
            (request as { projectId?: string } | undefined)?.projectId
          ) as Promise<{ ok: boolean; data?: unknown; error?: string }>
        case 'get-summary':
          return ipc.lint.getSummary() as Promise<{ ok: boolean; data?: unknown; error?: string }>
      }
      break
    }
    case 'settings': {
      switch (action) {
        case 'get':
          return ipc.settings.get() as Promise<{ ok: boolean; data?: unknown; error?: string }>
        case 'set':
          return ipc.settings.set(request as Parameters<typeof ipc.settings.set>[0]) as Promise<{
            ok: boolean
            data?: unknown
            error?: string
          }>
      }
      break
    }
    case 'updates': {
      switch (action) {
        case 'check':
          return ipc.updates.check() as Promise<{ ok: boolean; data?: unknown; error?: string }>
        case 'download':
          return ipc.updates.download() as Promise<{ ok: boolean; data?: unknown; error?: string }>
        case 'install':
          return ipc.updates.install() as Promise<{ ok: boolean; data?: unknown; error?: string }>
      }
      break
    }
  }

  return Promise.reject(new Error(`Unknown IPC channel: ${channel}`))
}
