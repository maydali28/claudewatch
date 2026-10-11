import React from 'react'
import { Layers, CheckCircle, XCircle, Info } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { useConfigStore } from '@renderer/store/config.store'
import { EmptyState } from '@renderer/components/shared/empty-state'
import type { SkillEntry } from '@shared/types'
import MarkdownBody from '@renderer/components/shared/markdown-body'
import { lineCount } from '@renderer/components/shared/markdown-body-rules'
import { pluginTags } from './source-group-decor'
import { relativeDay, sessionOnlyNote } from './skill-usage'

/** "user" | "<project> · project" | "<plugin> · plugin (tags)" | "built-in" */
function skillSourceLabel(skill: SkillEntry): string {
  const source = skill.source
  if (!source) return ''
  switch (source.kind) {
    case 'user':
      return 'user'
    case 'project':
    case 'local':
      return `${source.label} · project`
    case 'plugin': {
      const tags = pluginTags(source)
      return `${source.label} · plugin${tags.length > 0 ? ` (${tags.join(', ')})` : ''}`
    }
    case 'managed':
      return 'managed'
    case 'builtin':
      return 'built-in'
  }
}

const KEBAB_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

// ─── Validation badge ─────────────────────────────────────────────────────────

function ValidationBadge({ ok, label }: { ok: boolean; label: string }): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded',
        ok
          ? 'bg-green-500/10 text-green-600 dark:text-green-400'
          : 'bg-red-500/10 text-red-600 dark:text-red-400'
      )}
    >
      {ok ? <CheckCircle className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
      {label}
    </span>
  )
}

// ─── Skill detail view ────────────────────────────────────────────────────────

/** One skill in full; also shown from the Plugins tab. */
export function SkillDetail({ skill }: { skill: SkillEntry }): React.JSX.Element {
  const note = sessionOnlyNote(skill)
  // The naming rules apply to the skill's own name; Claude Code adds the
  // `<plugin>:` prefix itself.
  const prefix = skill.source?.kind === 'plugin' ? `${skill.source.label}:` : ''
  const ownName =
    prefix && skill.name.startsWith(prefix) ? skill.name.slice(prefix.length) : skill.name
  const isValidKebab = KEBAB_RE.test(ownName)
  const nameLen = ownName.length
  const descLen = (skill.description ?? '').length
  const bodyLines = lineCount(skill.body)
  const hasReservedWords = /claude|anthropic/i.test(ownName)
  const hasAngleBrackets = /[<>]/.test(ownName + (skill.description ?? ''))

  const validationChecks = [
    { ok: isValidKebab, label: 'kebab-case name' },
    { ok: nameLen <= 64, label: `name ≤ 64 chars (${nameLen})` },
    { ok: !!skill.description, label: 'description present' },
    { ok: descLen <= 1024, label: `desc ≤ 1 024 chars (${descLen})` },
    { ok: !hasReservedWords, label: 'no reserved words' },
    { ok: !hasAngleBrackets, label: 'no angle brackets' },
    { ok: bodyLines <= 500, label: `body ≤ 500 lines (${bodyLines})` },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-start gap-3 px-6 py-4 border-b border-border/50 shrink-0">
        <Layers className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold">{skill.displayName || skill.name}</h2>
          <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{skill.name}</p>
          {skill.description && (
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {skill.description}
            </p>
          )}
          <p className="text-[10px] text-muted-foreground mt-1">
            {skillSourceLabel(skill)}
            {skill.lastSeen && (
              <>
                {' '}
                · seen {relativeDay(skill.lastSeen)} in {skill.sessionCount ?? 0} session
                {skill.sessionCount === 1 ? '' : 's'}
              </>
            )}
          </p>
          {skill.filePath && (
            <p
              className="text-[10px] text-muted-foreground/50 mt-0.5 truncate font-mono"
              title={skill.filePath}
            >
              {skill.filePath}
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {note && (
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            {note}
          </div>
        )}

        {/* Validation applies to SKILL.md files only. */}
        {!note && (
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-2">
              Validation
            </p>
            <div className="flex flex-wrap gap-1.5">
              {validationChecks.map((c) => (
                <ValidationBadge key={c.label} ok={c.ok} label={c.label} />
              ))}
            </div>
          </div>
        )}

        {/* Metadata */}
        {Object.keys(skill.metadata).length > 0 && (
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-2">
              Metadata
            </p>
            <div className="rounded-lg border border-border bg-muted/20 divide-y divide-border/40">
              {Object.entries(skill.metadata).map(([k, v]) => (
                <div key={k} className="flex items-start gap-3 px-3 py-2">
                  <span className="text-[10px] text-muted-foreground font-mono shrink-0 w-24 pt-0.5">
                    {k}
                  </span>
                  <span className="text-xs text-foreground break-all">{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Body */}
        {!note && <MarkdownBody content={skill.body} label="Body" />}
      </div>
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function SkillsPanel(): React.JSX.Element {
  const { skills, selectedSkillId } = useConfigStore()
  const selected = skills.find((s) => s.id === selectedSkillId) ?? null

  if (!selected)
    return (
      <EmptyState
        icon={Layers}
        title="No skill selected"
        description="Choose a skill from the sidebar to view its details and validation status"
      />
    )
  return <SkillDetail skill={selected} />
}
