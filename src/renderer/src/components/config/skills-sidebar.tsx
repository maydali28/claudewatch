import React, { useState } from 'react'
import { RefreshCw, Search, X, FolderOpen, ChevronDown, ChevronRight, Layers } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { useConfigStore } from '@renderer/store/config.store'
import { Skeleton } from '@renderer/components/ui/skeleton'
import type { SkillEntry } from '@shared/types'
import type { ProjectSkillEntry } from '@shared/types/project'

type AnySkill = (SkillEntry & { projectId?: undefined }) | ProjectSkillEntry

function skillItemId(skill: AnySkill): string {
  return skill.projectId ? `project:${skill.projectId}:${skill.id}` : skill.id
}

function SkillItem({
  skill,
  selectedId,
  onSelect,
}: {
  skill: AnySkill
  selectedId: string | null
  onSelect: (id: string) => void
}): React.JSX.Element {
  const id = skillItemId(skill)
  return (
    <button
      onClick={() => onSelect(id)}
      className={cn(
        'w-full rounded-md px-2.5 py-2 text-left transition-colors',
        selectedId === id ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-accent'
      )}
    >
      <p
        className={cn(
          'text-xs font-medium truncate',
          selectedId === id ? 'text-primary' : 'text-foreground'
        )}
      >
        {skill.displayName || skill.name}
      </p>
      {skill.description && (
        <p className="text-[10px] text-muted-foreground truncate mt-0.5 leading-relaxed">
          {skill.description}
        </p>
      )}
      <p className="text-[10px] text-muted-foreground/50 mt-0.5 font-mono">{skill.name}</p>
    </button>
  )
}

function CollapsibleGroup({
  label,
  count,
  icon,
  defaultExpanded = true,
  children,
}: {
  label: string
  count: number
  icon?: React.ReactNode
  defaultExpanded?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left hover:bg-accent/40 rounded-md transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        {icon}
        <span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider truncate flex-1">
          {label}
        </span>
        <span className="text-[10px] text-muted-foreground/40 shrink-0">{count}</span>
      </button>
      {expanded && (
        <div className="ml-2 border-l border-border/40 pl-1.5 space-y-0.5">{children}</div>
      )}
    </div>
  )
}

export default function SkillsSidebar(): React.JSX.Element {
  const isLoading = useConfigStore((s) => s.isLoading)
  const skills = useConfigStore((s) => s.skills)
  const projectSkills = useConfigStore((s) => s.projectSkills)
  const loadAll = useConfigStore((s) => s.loadAll)
  const selectedSkillId = useConfigStore((s) => s.selectedSkillId)
  const setSelectedSkill = useConfigStore((s) => s.setSelectedSkill)
  const [search, setSearch] = useState('')

  const q = search.toLowerCase()

  const filteredGlobal = skills.filter(
    (s) => s.name.toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q)
  )

  const filteredProject = projectSkills.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      (s.description ?? '').toLowerCase().includes(q) ||
      s.projectName.toLowerCase().includes(q)
  )

  const byProject = filteredProject.reduce<Record<string, ProjectSkillEntry[]>>((acc, s) => {
    ;(acc[s.projectId] ??= []).push(s)
    return acc
  }, {})

  const total = skills.length + projectSkills.length

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

        {!isLoading &&
          total > 0 &&
          filteredGlobal.length === 0 &&
          Object.keys(byProject).length === 0 &&
          search && (
            <div className="flex flex-col items-center justify-center py-12 text-center px-3">
              <p className="text-xs text-muted-foreground">No matches for &quot;{search}&quot;</p>
            </div>
          )}

        {filteredGlobal.length > 0 && (
          <CollapsibleGroup label="Global" count={filteredGlobal.length}>
            {filteredGlobal.map((s) => (
              <SkillItem
                key={s.id}
                skill={s}
                selectedId={selectedSkillId}
                onSelect={setSelectedSkill}
              />
            ))}
          </CollapsibleGroup>
        )}

        {Object.entries(byProject).map(([, skills]) => {
          const first = skills[0]
          return (
            <CollapsibleGroup
              key={first.projectId}
              label={first.projectName}
              count={skills.length}
              icon={<FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
            >
              {skills.map((s) => (
                <SkillItem
                  key={skillItemId(s)}
                  skill={s}
                  selectedId={selectedSkillId}
                  onSelect={setSelectedSkill}
                />
              ))}
            </CollapsibleGroup>
          )
        })}
      </div>
    </div>
  )
}
