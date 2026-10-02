import React from 'react'
import { FolderOpen, Package, Puzzle, ShieldCheck } from 'lucide-react'
import type { ConfigSource } from '@shared/types'
import type { SourceGroupKind } from './scope-groups'

/**
 * A plugin version as shown in a group tag: marketplace plugins pinned to a
 * commit carry a 12-character hash as their version, cut here to 7.
 */
export function shortVersion(version: string): string {
  return /^[0-9a-f]{12,}$/i.test(version) ? version.slice(0, 7) : version
}

/** Tags for a plugin group header: version, "claude.ai" for synced plugins, "disabled". */
export function pluginTags(source: ConfigSource | undefined): string[] {
  const plugin = source?.plugin
  if (!plugin) return []
  if (plugin.installed === false) return ['not installed']
  return [
    ...(plugin.version ? [shortVersion(plugin.version)] : []),
    ...(plugin.origin === 'claude.ai' ? ['claude.ai'] : []),
    ...(plugin.enabled ? [] : ['disabled']),
  ]
}

/** Icon, tags and dimming for a source group header in the setup sidebars. */
export function sourceGroupDecor(group: { kind: SourceGroupKind; source?: ConfigSource }): {
  icon?: React.ReactNode
  tags: string[]
  muted: boolean
} {
  switch (group.kind) {
    case 'project':
      return {
        icon: <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" />,
        tags: [],
        muted: false,
      }
    case 'plugin':
      return {
        icon: <Puzzle className="h-3.5 w-3.5 shrink-0 text-violet-500" />,
        tags: pluginTags(group.source),
        muted: group.source?.plugin?.enabled === false,
      }
    case 'managed':
      return {
        icon: <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-sky-500" />,
        tags: [],
        muted: false,
      }
    case 'builtin':
      return {
        icon: <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />,
        tags: [],
        muted: false,
      }
    default:
      return { tags: [], muted: false }
  }
}
