import React, { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { Label } from '@renderer/components/ui/label'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select'
import { useSettingsStore } from '@renderer/store/settings.store'
import { getModelMeta } from '@renderer/lib/model-meta'
import { cn } from '@renderer/lib/cn'
import { ANTHROPIC_PRICING, getPricingTable } from '@shared/constants/pricing'
import { COST_ESTIMATE_NOTE } from '@shared/constants/copy'
import type { PricingProvider, ModelFamily, RateKey } from '@shared/types'
import {
  applyOverrideEdit,
  countOverriddenFields,
  parseRateInput,
  resetFamilyOverrides,
  type PricingOverrides,
} from './pricing-overrides'

const PROVIDERS: { value: PricingProvider; label: string }[] = [
  { value: 'anthropic', label: 'Anthropic API' },
]

const MODEL_FAMILIES = Object.keys(ANTHROPIC_PRICING).filter(
  (k) => k !== 'unknown'
) as ModelFamily[]

const RATE_FIELDS: { field: RateKey; label: string }[] = [
  { field: 'input', label: 'Input' },
  { field: 'output', label: 'Output' },
  { field: 'cacheRead', label: 'Cache read' },
]

function formatRate(rate: number): string {
  return rate.toFixed(2)
}

interface RateCellProps {
  modelLabel: string
  fieldLabel: string
  /** Undefined when there is no rate to fall back on (a model with no family). */
  defaultRate: number | undefined
  override: number | undefined
  onCommit: (value: number | undefined) => void
}

// Shows the default rate as a placeholder and the override, if any, as the
// value. The draft is local so a half-typed or invalid entry never reaches the
// store; it is committed on blur or Enter and reverted with Escape.
export function RateCell({
  modelLabel,
  fieldLabel,
  defaultRate,
  override,
  onCommit,
}: RateCellProps): React.JSX.Element {
  const stored = override === undefined ? '' : String(override)
  const [draft, setDraft] = useState(stored)
  const [error, setError] = useState<string | null>(null)

  // Follow the store when it changes from elsewhere (Reset, another window).
  const [prevStored, setPrevStored] = useState(stored)
  if (stored !== prevStored) {
    setPrevStored(stored)
    setDraft(stored)
    setError(null)
  }

  function commit(): void {
    const parsed = parseRateInput(draft)
    if (parsed.kind === 'invalid') {
      setError(parsed.message)
      return
    }
    setError(null)
    const value = parsed.kind === 'value' ? parsed.value : undefined
    if (value === override) return
    // Typing the default rate is the same as clearing the field.
    if (value === undefined || value === defaultRate) setDraft('')
    onCommit(value)
  }

  const isOverridden = override !== undefined

  return (
    <div className="flex flex-col items-end gap-0.5">
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        placeholder={defaultRate === undefined ? '—' : formatRate(defaultRate)}
        aria-label={`${modelLabel} ${fieldLabel.toLowerCase()} rate, dollars per million tokens`}
        aria-invalid={error !== null}
        title={
          isOverridden && defaultRate !== undefined
            ? `Default ${formatRate(defaultRate)}`
            : undefined
        }
        onChange={(e) => {
          setDraft(e.target.value)
          if (error) setError(null)
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setDraft(stored)
            setError(null)
          }
        }}
        className={cn(
          'h-7 w-20 rounded-md border bg-transparent px-2 text-right text-xs tabular-nums',
          'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          // `!` because the unlayered `* { border-color }` reset in index.css
          // outranks Tailwind's layered border-color utilities.
          'border-transparent! hover:border-input! focus-visible:border-input!',
          isOverridden && 'border-primary/60! bg-primary/5 font-medium text-foreground',
          error && 'border-destructive! hover:border-destructive! focus-visible:border-destructive!'
        )}
      />
      {error && <span className="text-[10px] leading-tight text-destructive">{error}</span>}
    </div>
  )
}

export default function PricingSettings(): React.JSX.Element {
  const { prefs, updatePref } = useSettingsStore()
  const table = getPricingTable(prefs.pricingProvider)
  const overrides = prefs.pricingOverrides
  const customCount = countOverriddenFields(overrides)
  // Bumped on every reset so the cells remount and drop any unsaved or invalid
  // draft, even in a cell whose stored value did not change.
  const [resetCount, setResetCount] = useState(0)

  // Read the latest overrides at call time: a blur commit and a Reset click
  // can land in the same tick, before this component re-renders.
  function saveOverrides(update: (current: PricingOverrides) => PricingOverrides): void {
    const current = useSettingsStore.getState().prefs.pricingOverrides
    void updatePref('pricingOverrides', update(current))
  }

  function resetOverrides(update: (current: PricingOverrides) => PricingOverrides): void {
    saveOverrides(update)
    setResetCount((n) => n + 1)
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div>
          <Label htmlFor="provider-select">Provider</Label>
          <p className="text-xs text-muted-foreground mb-2">
            ClaudeWatch prices usage at Anthropic API list rates. Other providers&apos; rates are
            not supported yet.
          </p>
          <Select
            value={prefs.pricingProvider}
            onValueChange={(v) => updatePref('pricingProvider', v as PricingProvider)}
          >
            <SelectTrigger id="provider-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDERS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-2 text-xs text-muted-foreground">{COST_ESTIMATE_NOTE}</p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium">Rates</h4>
            {customCount > 0 && (
              <Badge variant="warning">
                {customCount} custom {customCount === 1 ? 'rate' : 'rates'}
              </Badge>
            )}
          </div>
          {customCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => resetOverrides(() => ({}))}
            >
              Reset all
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Dollars per million tokens. Type a rate to use your own; clear the field to go back to the
          list rate.
        </p>
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="text-left px-3 py-2 font-medium">Model</th>
                {RATE_FIELDS.map(({ field, label }) => (
                  <th key={field} className="text-right px-3 py-2 font-medium">
                    {label}
                  </th>
                ))}
                <th className="w-9 px-1 py-2">
                  <span className="sr-only">Reset</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {MODEL_FAMILIES.map((family) => {
                const base = table[family]
                if (!base) return null
                const familyOverride = overrides[family]
                const hasOverride = familyOverride !== undefined
                const modelLabel = getModelMeta(family).label
                return (
                  <tr
                    key={family}
                    className={cn('border-b last:border-b-0', hasOverride && 'bg-primary/[0.03]')}
                  >
                    <td
                      className={cn(
                        'px-3 py-1',
                        hasOverride ? 'font-medium text-foreground' : 'text-muted-foreground'
                      )}
                    >
                      {modelLabel}
                      {base.longContext && (
                        <span className="block text-[10px] font-normal text-muted-foreground">
                          {hasOverride
                            ? 'Your rates apply at any prompt length'
                            : `Prompts over ${base.longContext.above / 1000}K: $${base.longContext.input} in, $${base.longContext.output} out`}
                        </span>
                      )}
                    </td>
                    {RATE_FIELDS.map(({ field, label }) => (
                      <td key={field} className="px-2 py-1 text-right">
                        <RateCell
                          key={resetCount}
                          modelLabel={modelLabel}
                          fieldLabel={label}
                          defaultRate={base[field]}
                          override={familyOverride?.[field]}
                          onCommit={(value) =>
                            saveOverrides((current) =>
                              applyOverrideEdit(current, family, field, value, base[field])
                            )
                          }
                        />
                      </td>
                    ))}
                    <td className="px-1 py-1 text-center">
                      {hasOverride && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label={`Reset ${modelLabel} to list rates`}
                          title="Reset to list rates"
                          onClick={() =>
                            resetOverrides((current) => resetFamilyOverrides(current, family))
                          }
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
