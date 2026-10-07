import React, { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, RotateCcw } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select'
import { useSettingsStore } from '@renderer/store/settings.store'
import { familyLabel } from '@renderer/lib/model-meta'
import { ipc } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/cn'
import { CHANNELS } from '@shared/ipc/channels'
import { getModelFamily } from '@shared/constants/models'
import {
  PRICED_FAMILIES,
  getActivePricingTable,
  ratesFor,
  resolveModelFamily,
} from '@shared/constants/pricing'
import type {
  ModelFamily,
  ModelPreference,
  ModelPreferences,
  ModelPricing,
  SeenModel,
} from '@shared/types'
import { RateCell } from './pricing-settings'
import { editModelPreference, suggestModelFamily } from './model-preferences'

const AUTO = 'auto'

const RATE_FIELDS: { field: keyof ModelPricing; label: string }[] = [
  { field: 'input', label: 'Input' },
  { field: 'output', label: 'Output' },
  { field: 'cacheRead', label: 'Cache read' },
  { field: 'cache5m', label: '5m write' },
  { field: 'cache1h', label: '1h write' },
]

function useSeenModels(): SeenModel[] | null {
  const [models, setModels] = useState<SeenModel[] | null>(null)
  useEffect(() => {
    let cancelled = false
    const load = (): void => {
      void ipc.analytics.listModels().then((r) => {
        if (!cancelled && r.ok) setModels(r.data)
      })
    }
    load()
    // A mapping reprices the scan; read the models again once it has.
    const off = ipc.on(CHANNELS.PUSH_PRICING_CHANGED, load)
    return () => {
      cancelled = true
      off()
    }
  }, [])
  return models
}

function formatDay(day: string): string {
  if (!day) return ''
  const d = new Date(`${day}T00:00:00`)
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function usageLine(seen: SeenModel | undefined): string {
  if (!seen) return 'Not seen in your transcripts yet'
  const responses = `${seen.responses.toLocaleString()} response${seen.responses === 1 ? '' : 's'}`
  return seen.lastDay ? `${responses} · last used ${formatDay(seen.lastDay)}` : responses
}

interface RowProps {
  model: string
  pref: ModelPreference | undefined
  seen: SeenModel | undefined
  /** Family rates after the user's family overrides, without any model's own. */
  familyTable: Record<ModelFamily, ModelPricing>
  priced: boolean
  expanded: boolean
  onToggle: () => void
  onEdit: (edit: (current: ModelPreference) => ModelPreference) => void
}

function ModelRow({
  model,
  pref,
  seen,
  familyTable,
  priced,
  expanded,
  onToggle,
  onEdit,
}: RowProps): React.JSX.Element {
  const builtIn = getModelFamily(model)
  const family = pref?.family ?? builtIn
  const familyRates = family === 'unknown' ? undefined : familyTable[family]
  const hasOwnRates = Object.keys(pref?.rates ?? {}).length > 0
  const [name, setName] = useState(pref?.displayName ?? '')
  const [prevName, setPrevName] = useState(pref?.displayName ?? '')
  if ((pref?.displayName ?? '') !== prevName) {
    setPrevName(pref?.displayName ?? '')
    setName(pref?.displayName ?? '')
  }

  function commitName(): void {
    if (name.trim() === (pref?.displayName ?? '')) return
    onEdit((p) => ({ ...p, displayName: name }))
  }

  const status = !priced ? (
    <Badge className="shrink-0 whitespace-nowrap" variant="warning">
      Unpriced
    </Badge>
  ) : pref?.family ? (
    <Badge className="shrink-0 whitespace-nowrap" variant="secondary">
      Mapped
    </Badge>
  ) : hasOwnRates ? (
    <Badge className="shrink-0 whitespace-nowrap" variant="secondary">
      Own rates
    </Badge>
  ) : null

  return (
    <div className="border-b last:border-b-0" data-model-row={model}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Hide' : 'Show'} details for ${model}`}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-mono text-xs" title={model}>
              {model}
            </p>
            {status}
          </div>
          <p className="truncate text-[11px] text-muted-foreground">
            {pref?.displayName ? `${pref.displayName} · ` : ''}
            {usageLine(seen)}
          </p>
        </div>
        <Select
          value={pref?.family ?? AUTO}
          onValueChange={(v) =>
            onEdit((p) => ({ ...p, family: v === AUTO ? undefined : (v as ModelFamily) }))
          }
        >
          <SelectTrigger className="h-7 w-44 shrink-0 text-xs" aria-label={`Family for ${model}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={AUTO}>
              {builtIn === 'unknown' ? 'Not mapped' : `Built in: ${familyLabel(builtIn)}`}
            </SelectItem>
            {PRICED_FAMILIES.map((f) => (
              <SelectItem key={f} value={f}>
                {familyLabel(f)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {expanded && (
        <div className="space-y-3 bg-muted/20 px-3 pb-3 pl-9 pt-1">
          <div className="space-y-1">
            <Label htmlFor={`name-${model}`} className="text-xs">
              Display name
            </Label>
            <Input
              id={`name-${model}`}
              value={name}
              maxLength={80}
              placeholder={family === 'unknown' ? 'e.g. Team Sonnet' : familyLabel(family)}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') setName(pref?.displayName ?? '')
              }}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium">Own rates</p>
            <p className="text-[11px] text-muted-foreground">
              {familyRates
                ? `Dollars per million tokens. Empty fields use ${familyLabel(family)}’s rates.`
                : 'Dollars per million tokens. With no family, fill in all five or the model stays unpriced.'}
            </p>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {RATE_FIELDS.map(({ field, label }) => (
                <div key={field} className="flex flex-col items-end">
                  <span className="text-[10px] text-muted-foreground">{label}</span>
                  <RateCell
                    modelLabel={model}
                    fieldLabel={label}
                    defaultRate={familyRates?.[field]}
                    override={pref?.rates?.[field]}
                    onCommit={(value) =>
                      onEdit((p) => ({
                        ...p,
                        rates: {
                          ...p.rates,
                          [field]: value === familyRates?.[field] ? undefined : value,
                        },
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          </div>
          {pref && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onEdit(() => ({}))}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Clear this model’s settings
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

export default function ModelsSettings(): React.JSX.Element {
  const prefs = useSettingsStore((s) => s.prefs)
  const updatePref = useSettingsStore((s) => s.updatePref)
  const seen = useSeenModels()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [added, setAdded] = useState<string[]>([])
  const [newId, setNewId] = useState('')

  const modelPrefs: ModelPreferences = useMemo(
    () => prefs.modelPreferences ?? {},
    [prefs.modelPreferences]
  )
  const table = useMemo(() => getActivePricingTable(prefs), [prefs])
  const familyTable = useMemo(
    () =>
      getActivePricingTable({
        pricingProvider: prefs.pricingProvider,
        pricingOverrides: prefs.pricingOverrides,
      }),
    [prefs.pricingProvider, prefs.pricingOverrides]
  )

  const seenById = useMemo(() => new Map((seen ?? []).map((m) => [m.model, m])), [seen])
  const isPriced = (model: string): boolean =>
    !!ratesFor(table, resolveModelFamily(model, table), model)

  // Seen models first, in the order main sends them (unpriced first), then
  // models configured or added here that no transcript has used yet.
  const rows = useMemo(() => {
    const ids = (seen ?? []).map((m) => m.model)
    for (const id of [...Object.keys(modelPrefs), ...added]) if (!ids.includes(id)) ids.push(id)
    return ids
  }, [seen, modelPrefs, added])

  const unmapped = rows.filter((id) => seenById.has(id) && !isPriced(id))

  // Read the latest map at call time: a blur commit and a select change can
  // land in the same tick, before this component re-renders.
  function edit(model: string, change: (current: ModelPreference) => ModelPreference): void {
    const current = useSettingsStore.getState().prefs.modelPreferences ?? {}
    void updatePref('modelPreferences', editModelPreference(current, model, change))
  }

  function openRow(id: string): void {
    setExpanded(id)
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-model-row="${window.CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    )
  }

  function addModel(): void {
    const id = newId.trim()
    if (!id) return
    if (!rows.includes(id)) setAdded((a) => [...a, id])
    openRow(id)
    setNewId('')
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Gateway aliases, Bedrock ARNs and Foundry deployment names are not in the built-in price
        list, so their usage shows as unpriced. Map each one to the model it stands for, or give it
        rates of its own. A display name replaces the ID wherever the model is shown.
      </p>

      {unmapped.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium">Needs mapping</h4>
            <Badge variant="warning">{unmapped.length}</Badge>
          </div>
          <div className="space-y-1.5">
            {unmapped.map((id) => {
              const s = seenById.get(id)
              const suggestion = suggestModelFamily(id)
              return (
                <div
                  key={id}
                  className="flex items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs" title={id}>
                      {id}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {`${(s?.unpricedResponses ?? 0).toLocaleString()} unpriced responses`}
                    </p>
                  </div>
                  {suggestion ? (
                    <Button
                      size="sm"
                      className="h-7 shrink-0 px-2 text-xs"
                      onClick={() => edit(id, (p) => ({ ...p, family: suggestion }))}
                    >
                      Map to {familyLabel(suggestion)}
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 px-2 text-xs"
                    onClick={() => openRow(id)}
                  >
                    {suggestion ? 'Other…' : 'Choose…'}
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h4 className="text-sm font-medium">Models</h4>
        <div className="overflow-hidden rounded-lg border">
          {seen === null && rows.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground">Reading your transcripts…</p>
          ) : rows.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground">
              No models in your transcripts yet. Add an ID below to set it up ahead of time.
            </p>
          ) : (
            rows.map((id) => (
              <ModelRow
                key={id}
                model={id}
                pref={modelPrefs[id]}
                seen={seenById.get(id)}
                familyTable={familyTable}
                priced={isPriced(id)}
                expanded={expanded === id}
                onToggle={() => setExpanded((e) => (e === id ? null : id))}
                onEdit={(change) => edit(id, change)}
              />
            ))
          )}
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            addModel()
          }}
        >
          <Input
            value={newId}
            onChange={(e) => setNewId(e.target.value)}
            placeholder="Add a model ID, exactly as Claude Code reports it"
            aria-label="Model ID to add"
            maxLength={512}
            className={cn('h-8 font-mono text-xs')}
          />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            className="h-8"
            disabled={!newId.trim()}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add
          </Button>
        </form>
      </div>
    </div>
  )
}
