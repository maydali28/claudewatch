import type { ConfigSource, HookInactiveReason, HookRule, HookScope } from '@shared/types'

/** Sort rank, lowest first: user → project → local → plugin → managed. */
const SCOPE_RANK: Record<HookScope, number> = {
  user: 0,
  project: 1,
  local: 2,
  plugin: 3,
  managed: 4,
}

type LabelInput = Pick<HookRule, 'scope' | 'projectName'> & {
  source?: Pick<ConfigSource, 'label'>
}

/** "user" | "<project> · project" | "<project> · local" | "<plugin> · plugin" | "managed" */
export function hookScopeLabel(rule: LabelInput): string {
  switch (rule.scope) {
    case 'user':
      return 'user'
    case 'project':
      return rule.projectName ? `${rule.projectName} · project` : 'project'
    case 'local':
      return rule.projectName ? `${rule.projectName} · local` : 'local'
    case 'plugin':
      return rule.source?.label ? `${rule.source.label} · plugin` : 'plugin'
    case 'managed':
      return 'managed'
  }
}

/** Sort key so rules render user → project → local → plugin → managed, then by project name. */
export function hookScopeOrder(rule: Pick<HookRule, 'scope' | 'projectName'>): string {
  return `${SCOPE_RANK[rule.scope]}-${rule.projectName ?? ''}`
}

/** Why Claude Code will not run a rule, in the words the panel shows. */
export function inactiveReasonText(reason: HookInactiveReason): string {
  switch (reason) {
    case 'plugin-disabled':
      return "Won't run: the plugin is disabled"
    case 'managed-only':
      return "Won't run: managed settings allow only managed hooks"
  }
}

/**
 * Claude Code's hook `timeout` is in seconds (default 60), not milliseconds —
 * render it that way instead of appending `ms` to the raw number.
 */
export function formatHookTimeout(seconds: number): string {
  return `${seconds}s`
}
