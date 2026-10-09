import type { SkillEntry } from '@shared/types'

/** "today", "yesterday", "7d ago", or the date for anything a month old or more. */
export function relativeDay(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso)
  if (!iso || Number.isNaN(t)) return ''
  const days = Math.floor((now - t) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const FROM_SESSIONS = 'It has no file on disk; name and description come from your sessions.'

/** Where a skill with no `SKILL.md` comes from, for the detail panel; null for a skill with a file. */
export function sessionOnlyNote(skill: SkillEntry): string | null {
  if (!skill.sessionOnly) return null
  if (skill.exposedAs === 'command') {
    return `The /${skill.name} command, which Claude Code also offers as a skill.`
  }
  const plugin = skill.source?.plugin
  if (plugin?.installed === false) {
    return `From the ${plugin.name} plugin, which is no longer installed. Last known from your sessions.`
  }
  if (plugin?.origin === 'claude.ai') return `Provided by your claude.ai account. ${FROM_SESSIONS}`
  if (plugin) return `From the ${plugin.name} plugin. ${FROM_SESSIONS}`
  return `Built into Claude Code. ${FROM_SESSIONS}`
}
