import type { ProjectRootRef } from '@shared/types/config'
import { scanCache } from './scan-cache'

/**
 * Projects whose real root is known from a transcript `cwd`. Projects that
 * only have the lossy decoded directory name are left out: a guessed path
 * would read settings, hooks and CLAUDE.md from the wrong folder.
 *
 * Lives in services (not `ipc/config.handlers.ts`, which re-exports it) so
 * `lint-service` can use it without importing an IPC module.
 */
export async function resolvedProjectRoots(): Promise<ProjectRootRef[]> {
  const { projects } = await scanCache.get()
  return projects
    .filter((p) => p.pathResolved)
    .map((p) => ({ id: p.id, name: p.name, path: p.path }))
}
