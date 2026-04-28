import React from 'react'
import { Webhook, Terminal, Clock } from 'lucide-react'
import { useConfigStore } from '@renderer/store/config.store'
import { EmptyState } from '@renderer/components/shared/empty-state'
import { Skeleton } from '@renderer/components/ui/skeleton'
import type { HookEventGroup, HookRule } from '@shared/types'

// ─── Hook detail ──────────────────────────────────────────────────────────────

function HookDetail({ group, rule }: { group: HookEventGroup; rule: HookRule }): React.JSX.Element {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-start gap-3 px-6 py-4 border-b border-border/50 shrink-0">
        <Webhook className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold">{group.event}</h2>
          <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
            matcher: {rule.matcher || '*'}
          </p>
        </div>
        <span className="text-xs text-muted-foreground shrink-0">
          {rule.hooks.length} command{rule.hooks.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* Matcher */}
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-2">
            Matcher
          </p>
          <code className="text-xs bg-muted px-2.5 py-1 rounded font-mono text-foreground">
            {rule.matcher || '*'}
          </code>
        </div>

        {/* Commands */}
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-2">
            Commands
          </p>
          <div className="space-y-2">
            {rule.hooks.map((hook, i) => (
              <div key={i} className="rounded-lg border border-border bg-muted/20 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40 bg-muted/30">
                  <Terminal className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Command {i + 1}
                  </span>
                  {hook.timeout !== undefined && (
                    <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {hook.timeout}ms
                    </span>
                  )}
                </div>
                <pre className="px-3 py-2.5 text-xs font-mono text-foreground whitespace-pre-wrap break-all leading-relaxed">
                  {hook.command}
                </pre>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function HooksPanel(): React.JSX.Element {
  const { hooks, isLoading, hasLoaded, selectedHookId } = useConfigStore()

  if (isLoading && !hasLoaded) {
    return (
      <div className="p-6 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    )
  }

  if (!selectedHookId)
    return (
      <EmptyState
        icon={Webhook}
        title="No hook selected"
        description="Choose a hook rule from the sidebar to view its commands"
      />
    )

  // Resolve selected rule from id format "groupId::ruleId"
  const [groupId, ruleId] = selectedHookId.split('::')
  const group = hooks.find((g) => g.id === groupId)
  const rule = group?.rules.find((r) => r.id === ruleId)

  if (!group || !rule)
    return (
      <EmptyState
        icon={Webhook}
        title="No hook selected"
        description="Choose a hook rule from the sidebar to view its commands"
      />
    )

  return <HookDetail group={group} rule={rule} />
}
