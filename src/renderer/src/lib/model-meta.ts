import { getModelFamily } from '@shared/constants/models'
import type { ModelFamily } from '@shared/types'

interface ModelMeta {
  label: string
  /** Tailwind utility classes for a small badge: bg + text color */
  badgeClass: string
  /** Hex color for charts / non-Tailwind contexts */
  color: string
}

const META: Record<ModelFamily, ModelMeta> = {
  // ── Fable 5.1 / Mythos 5.1 — premium amber / fuchsia ─────────────────────────
  'fable-5-1': {
    label: 'Fable 5.1',
    badgeClass: 'bg-amber-500/10 text-amber-500',
    color: '#f59e0b',
  },
  'mythos-5-1': {
    label: 'Mythos 5.1',
    badgeClass: 'bg-fuchsia-500/10 text-fuchsia-500',
    color: '#d946ef',
  },
  // ── Fable 5 / Mythos 5 — premium amber / fuchsia ─────────────────────────────
  'fable-5': {
    label: 'Fable 5',
    badgeClass: 'bg-amber-500/10 text-amber-500',
    color: '#f59e0b',
  },
  'mythos-5': {
    label: 'Mythos 5',
    badgeClass: 'bg-fuchsia-500/10 text-fuchsia-500',
    color: '#d946ef',
  },
  // ── Opus 5.5 / 5 / 4.8 / 4.7 / 4.6 / 4.5 — reds ───────────────────────────
  'opus-5-5': { label: 'Opus 5.5', badgeClass: 'bg-red-500/10 text-red-500', color: '#ef4444' },
  'opus-5': { label: 'Opus 5', badgeClass: 'bg-red-500/10 text-red-500', color: '#ef4444' },
  'opus-4-8': { label: 'Opus 4.8', badgeClass: 'bg-red-500/10 text-red-500', color: '#ef4444' },
  'opus-4-7': { label: 'Opus 4.7', badgeClass: 'bg-red-500/10 text-red-500', color: '#ef4444' },
  'opus-4-6': { label: 'Opus 4.6', badgeClass: 'bg-red-500/10 text-red-500', color: '#ef4444' },
  'opus-4-5': { label: 'Opus 4.5', badgeClass: 'bg-red-500/10 text-red-500', color: '#ef4444' },
  // ── Opus 4.1 / 4 — oranges ──────────────────────────────────────────────────
  'opus-4-1': {
    label: 'Opus 4.1',
    badgeClass: 'bg-orange-500/10 text-orange-500',
    color: '#f97316',
  },
  'opus-4': { label: 'Opus 4', badgeClass: 'bg-orange-500/10 text-orange-500', color: '#f97316' },
  // ── Sonnet — indigos ─────────────────────────────────────────────────────────
  'sonnet-5': {
    label: 'Sonnet 5',
    badgeClass: 'bg-indigo-500/10 text-indigo-500',
    color: '#6366f1',
  },
  'sonnet-4-6': {
    label: 'Sonnet 4.6',
    badgeClass: 'bg-indigo-500/10 text-indigo-500',
    color: '#6366f1',
  },
  'sonnet-4-5': {
    label: 'Sonnet 4.5',
    badgeClass: 'bg-indigo-500/10 text-indigo-500',
    color: '#6366f1',
  },
  'sonnet-4': {
    label: 'Sonnet 4',
    badgeClass: 'bg-indigo-400/10 text-indigo-400',
    color: '#818cf8',
  },
  // ── Haiku — greens / cyans ───────────────────────────────────────────────────
  'haiku-4-5': {
    label: 'Haiku 4.5',
    badgeClass: 'bg-emerald-500/10 text-emerald-500',
    color: '#10b981',
  },
  'haiku-3-5': { label: 'Haiku 3.5', badgeClass: 'bg-cyan-500/10 text-cyan-500', color: '#06b6d4' },
  // ── Fallback ─────────────────────────────────────────────────────────────────
  unknown: { label: 'Claude', badgeClass: 'bg-slate-500/10 text-slate-400', color: '#94a3b8' },
}

export function getModelMeta(model: string | null | undefined): ModelMeta {
  return META[getModelFamily(model)] ?? META['unknown']
}
