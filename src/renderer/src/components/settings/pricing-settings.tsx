import React, { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Label } from '@renderer/components/ui/label'
import { Input } from '@renderer/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select'
import { useSettingsStore } from '@renderer/store/settings.store'
import { ANTHROPIC_PRICING, getPricingTable } from '@shared/constants/pricing'
import type { PricingProvider, VertexRegion, ModelFamily, ModelPricing } from '@shared/types'
const PROVIDERS: { value: PricingProvider; label: string }[] = [
  { value: 'anthropic', label: 'Anthropic API' },
  { value: 'vertex-global', label: 'Vertex AI (Global)' },
  { value: 'vertex-regional', label: 'Vertex AI (Regional)' },
]

const REGIONS: { value: VertexRegion; label: string }[] = [
  { value: 'us-east5', label: 'US East 5 (Ohio)' },
  { value: 'europe-west1', label: 'Europe West 1 (Belgium)' },
  { value: 'asia-southeast1', label: 'Asia Southeast 1 (Singapore)' },
]

const MODEL_FAMILIES = Object.keys(ANTHROPIC_PRICING).filter(
  (k) => k !== 'unknown'
) as ModelFamily[]

export default function PricingSettings(): React.JSX.Element {
  const { prefs, updatePref } = useSettingsStore()
  const [overridesOpen, setOverridesOpen] = useState(false)

  const table = getPricingTable(prefs.pricingProvider, prefs.pricingRegion)

  function handleOverride(family: ModelFamily, field: keyof ModelPricing, raw: string) {
    const num = parseFloat(raw)
    if (isNaN(num) || num < 0) return
    const current = prefs.pricingOverrides[family] ?? {}
    updatePref('pricingOverrides', {
      ...prefs.pricingOverrides,
      [family]: { ...current, [field]: num },
    })
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div>
          <Label htmlFor="provider-select">Provider</Label>
          <p className="text-xs text-muted-foreground mb-2">
            Select where you run Claude. This determines base token prices.
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
        </div>

        {prefs.pricingProvider === 'vertex-regional' && (
          <div>
            <Label htmlFor="region-select">Region</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Regional Vertex AI applies a 10% surcharge over global rates.
            </p>
            <Select
              value={prefs.pricingRegion}
              onValueChange={(v) => updatePref('pricingRegion', v as VertexRegion)}
            >
              <SelectTrigger id="region-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REGIONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Live pricing preview */}
      <div>
        <h4 className="text-sm font-medium mb-2">Current Rates (per M tokens)</h4>
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="text-left px-3 py-2 font-medium">Model</th>
                <th className="text-right px-3 py-2 font-medium">Input</th>
                <th className="text-right px-3 py-2 font-medium">Output</th>
                <th className="text-right px-3 py-2 font-medium">Cache Read</th>
              </tr>
            </thead>
            <tbody>
              {MODEL_FAMILIES.slice(0, 8).map((family, i) => {
                const row = table[family]
                if (!row) return null
                return (
                  <tr key={family} className={i % 2 === 0 ? 'bg-background' : 'bg-muted/20'}>
                    <td className="px-3 py-1.5 font-mono text-muted-foreground">{family}</td>
                    <td className="px-3 py-1.5 text-right">${row.input.toFixed(2)}</td>
                    <td className="px-3 py-1.5 text-right">${row.output.toFixed(2)}</td>
                    <td className="px-3 py-1.5 text-right">${row.cacheRead.toFixed(2)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-model overrides (advanced) */}
      <div>
        <button
          onClick={() => setOverridesOpen(!overridesOpen)}
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {overridesOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          Per-model price overrides (advanced)
        </button>

        {overridesOpen && (
          <div className="mt-3 space-y-4">
            <p className="text-xs text-muted-foreground">
              Override individual model prices. Leave blank to use the provider default.
            </p>
            {MODEL_FAMILIES.slice(0, 6).map((family) => {
              const override = prefs.pricingOverrides[family] ?? {}
              const base = table[family]
              if (!base) return null
              return (
                <div key={family} className="space-y-1.5">
                  <p className="text-xs font-mono font-medium">{family}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(['input', 'output', 'cacheRead'] as (keyof ModelPricing)[]).map((field) => (
                      <div key={field}>
                        <Label className="text-xs text-muted-foreground capitalize">{field}</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder={String(base[field])}
                          defaultValue={
                            override[field] !== undefined ? String(override[field]) : ''
                          }
                          onBlur={(e) => handleOverride(family, field, e.target.value)}
                          className="h-7 text-xs"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
