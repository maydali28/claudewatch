import { useQuery } from '@tanstack/react-query'
import { ipc } from '@renderer/lib/ipc-client'
import type { ClaudeDirSource } from '@shared/types'

// Static key: the folder only changes through Settings › Claude folder, and
// main reloads every window when it does, so a loaded page never sees it
// change underneath it.
const CLAUDE_PATHS_KEY = ['app', 'claude-paths'] as const

export interface ClaudePaths {
  claudeDir: string
  display: string
  source: ClaudeDirSource
  /** The folder without the app setting: environment, settings.json or default. */
  fallback: { claudeDir: string; source: ClaudeDirSource }
}

// Shown while the query is loading (and as the last-resort fallback on
// failure) so copy that reads `${paths.display}/plans/` etc. never renders
// blank or with a literal "undefined" before the first response lands.
const FALLBACK_PATHS: ClaudePaths = {
  claudeDir: '~/.claude',
  display: '~/.claude',
  source: 'default',
  fallback: { claudeDir: '~/.claude', source: 'default' },
}

async function fetchClaudePaths(): Promise<ClaudePaths> {
  const result = await ipc.app.getPaths()
  if (!result.ok) throw new Error(result.error)
  return result.data
}

/** Resolved `~/.claude` location (or its `CLAUDE_CONFIG_DIR` override), for UI copy. */
export function useClaudePaths(): ClaudePaths {
  const query = useQuery({
    queryKey: CLAUDE_PATHS_KEY,
    queryFn: fetchClaudePaths,
    staleTime: Infinity,
  })
  return query.data ?? FALLBACK_PATHS
}
