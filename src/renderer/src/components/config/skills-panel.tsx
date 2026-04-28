import React from 'react'
import { Layers, CheckCircle, XCircle, Code, Eye } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { useConfigStore } from '@renderer/store/config.store'
import { EmptyState } from '@renderer/components/shared/empty-state'
import type { SkillEntry } from '@shared/types'
import MarkdownRenderer from '@renderer/components/shared/markdown-renderer'

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

// ─── Body section with raw / preview toggle ───────────────────────────────────

function BodySection({
  content,
  lineCount,
}: {
  content: string
  lineCount: number
}): React.JSX.Element {
  const [mode, setMode] = React.useState<'preview' | 'raw'>('preview')

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
          Body ({lineCount} lines)
        </p>
        <div className="flex items-center rounded-md border border-border overflow-hidden">
          <button
            onClick={() => setMode('preview')}
            className={cn(
              'flex items-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors',
              mode === 'preview'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent'
            )}
          >
            <Eye className="h-3 w-3" />
            Preview
          </button>
          <button
            onClick={() => setMode('raw')}
            className={cn(
              'flex items-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors border-l border-border',
              mode === 'raw'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent'
            )}
          >
            <Code className="h-3 w-3" />
            Raw
          </button>
        </div>
      </div>

      {mode === 'preview' ? (
        <div className="rounded-lg border border-border bg-card p-5">
          <MarkdownRenderer content={content} />
        </div>
      ) : (
        <pre className="rounded-lg border border-border bg-muted/40 p-4 text-xs font-mono text-foreground whitespace-pre-wrap break-words leading-relaxed overflow-x-auto">
          {content}
        </pre>
      )}
    </div>
  )
}

// ─── Skill detail view ────────────────────────────────────────────────────────

function SkillDetail({ skill }: { skill: SkillEntry }): React.JSX.Element {
  const isValidKebab = KEBAB_RE.test(skill.name)
  const nameLen = skill.name.length
  const descLen = (skill.description ?? '').length
  const bodyLines = skill.body.split('\n').length
  const hasReservedWords = /claude|anthropic/i.test(skill.name)
  const hasAngleBrackets = /[<>]/.test(skill.name + (skill.description ?? ''))

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
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* Validation */}
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
        <BodySection content={skill.body} lineCount={bodyLines} />
      </div>
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function SkillsPanel(): React.JSX.Element {
  const { skills, projectSkills, selectedSkillId } = useConfigStore()
  const selected =
    skills.find((s) => s.id === selectedSkillId) ??
    projectSkills.find((s) => `project:${s.projectId}:${s.id}` === selectedSkillId) ??
    null

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
