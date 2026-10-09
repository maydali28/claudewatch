import React, { useState } from 'react'
import { RefreshCw, Search, X, Layers } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { useConfigStore } from '@renderer/store/config.store'
import { useUIStore } from '@renderer/store/ui.store'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { ScopeGroup } from './scope-group'
import { SourceChips } from './source-chips'
import { sourceGroupDecor } from './source-group-decor'
import {
  countBySourceFilter,
  groupBySource,
  matchesSourceFilter,
  type SourceFilter,
} from './scope-groups'
import { relativeDay } from './skill-usage'
import { isPluginSourced } from '@renderer/components/plugins/plugin-views'
import type { SkillEntry } from '@shared/types'

const UNKNOWN_SOURCE = { kind: 'user', id: 'user', label: 'Global' } as const

function SkillItem({
  skill,
  selectedId,
  onSelect,
}: {
  skill: SkillEntry
  selectedId: string | null
  onSelect: (id: string) => void
}): React.JSX.Element {
  const selected = selectedId === skill.id
  const inactive = skill.source?.plugin?.enabled === false
  return (
    <button
      onClick={() => onSelect(skill.id)}
      className={cn(
        'w-full rounded-md px-2.5 py-2 text-left transition-colors',
        selected ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-accent',
        inactive && 'opacity-60'
      )}
    >
      <p className="flex items-center gap-1.5 min-w-0">
        <span
          className={cn(
            'text-xs font-medium truncate',
            selected ? 'text-primary' : 'text-foreground'
          )}
        >
          {skill.displayName || skill.name}
        </span>
        {skill.exposedAs === 'command' && (
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 shrink-0">
            command
          </span>
        )}
      </p>
      {skill.description && (
        <p className="text-[10px] text-muted-foreground truncate mt-0.5 leading-relaxed">
          {skill.description}
        </p>
      )}
      {skill.lastSeen && (
        <p className="text-[10px] text-muted-foreground/50 mt-0.5">
          seen {relativeDay(skill.lastSeen)} · {skill.sessionCount ?? 0} session
          {skill.sessionCount === 1 ? '' : 's'}
        </p>
      )}
    </button>
  )
}

export default function SkillsSidebar(): React.JSX.Element {
  const isLoading = useConfigStore((s) => s.isLoading)
  const allSkills = useConfigStore((s) => s.skills)
  // Plugin skills, and the claude.ai account's, are listed in the Plugins tab.
  const skills = allSkills.filter((s) => !isPluginSourced(s.source))
  const loadAll = useConfigStore((s) => s.loadAll)
  const selectedSkillId = useConfigStore((s) => s.selectedSkillId)
  const setSelectedSkill = useConfigStore((s) => s.setSelectedSkill)
  const [search, setSearch] = useState('')
  const sourceFilter = (useUIStore((s) => s.sourceFilters.skills) ?? 'all') as SourceFilter
  const setSourceFilter = useUIStore((s) => s.setSourceFilter)

  const sourceOf = (s: SkillEntry) => s.source ?? UNKNOWN_SOURCE
  const q = search.toLowerCase()
  const searched = skills.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      (s.description ?? '').toLowerCase().includes(q) ||
      sourceOf(s).label.toLowerCase().includes(q)
  )
  const counts = countBySourceFilter(searched, sourceOf)
  const filtered = searched.filter((s) => matchesSourceFilter(sourceOf(s), sourceFilter))
  const groups = groupBySource(filtered, sourceOf)
  const total = skills.length

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Skills
          </span>
          {total > 0 && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
              {total}
            </span>
          )}
        </div>
        <button
          onClick={() => loadAll()}
          disabled={isLoading}
          className="p-1 rounded hover:bg-accent transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw
            className={cn('h-3.5 w-3.5 text-muted-foreground', isLoading && 'animate-spin')}
          />
        </button>
      </div>

      <div className="px-2 py-1.5 border-b border-border/30">
        <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
          <Search className="h-3 w-3 text-muted-foreground shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter skills…"
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="p-0.5 hover:text-foreground text-muted-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {total > 0 && (
        <SourceChips<SourceFilter>
          label="Filter skills by source"
          value={sourceFilter}
          onChange={(v) => setSourceFilter('skills', v)}
          options={[
            { value: 'all', label: 'All', count: counts.all },
            { value: 'user', label: 'User', count: counts.user },
            { value: 'project', label: 'Project', count: counts.project },
            { value: 'builtin', label: 'Built-in', count: counts.builtin },
          ]}
        />
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {isLoading && total === 0 && (
          <div className="flex flex-col gap-2 p-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        )}

        {!isLoading && total === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center px-3">
            <Layers className="h-6 w-6 text-muted-foreground/30 mb-2" />
            <p className="text-xs text-muted-foreground">No skills found</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1">
              Add skills to ~/.claude/skills/ or a project&apos;s .claude/skills/
            </p>
          </div>
        )}

        {!isLoading && total > 0 && groups.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center px-3">
            <p className="text-xs text-muted-foreground">
              {search ? <>No matches for &quot;{search}&quot;</> : 'No skills from this source'}
            </p>
          </div>
        )}

        {groups.map((g) => {
          const decor = sourceGroupDecor(g)
          return (
            <ScopeGroup
              key={g.key}
              label={g.label}
              count={g.items.length}
              icon={decor.icon}
              tags={decor.tags}
              muted={decor.muted}
            >
              {g.items.map((s) => (
                <SkillItem
                  key={s.id}
                  skill={s}
                  selectedId={selectedSkillId}
                  onSelect={setSelectedSkill}
                />
              ))}
            </ScopeGroup>
          )
        })}
      </div>
    </div>
  )
}
