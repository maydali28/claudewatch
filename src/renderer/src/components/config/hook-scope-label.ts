import type { ConfigScope, HookRule } from '@shared/types'

/** Sort rank, lowest first: user → project → local. */
const SCOPE_RANK: Record<ConfigScope, number> = {
  user: 0,
  project: 1,
  local: 2,
}

/** "user" | "<project> · project" | "<project> · local" */
export function hookScopeLabel(rule: Pick<HookRule, 'scope' | 'projectName'>): string {
  switch (rule.scope) {
    case 'user':
      return 'user'
    case 'project':
      return rule.projectName ? `${rule.projectName} · project` : 'project'
    case 'local':
      return rule.projectName ? `${rule.projectName} · local` : 'local'
  }
}

/** Sort key so rules render user → project → local, then by project name. */
export function hookScopeOrder(rule: Pick<HookRule, 'scope' | 'projectName'>): string {
  return `${SCOPE_RANK[rule.scope]}-${rule.projectName ?? ''}`
}

/**
 * Claude Code's hook `timeout` is in seconds (default 60), not milliseconds —
 * render it that way instead of appending `ms` to the raw number.
 */
export function formatHookTimeout(seconds: number): string {
  return `${seconds}s`
}
