import React from 'react'
import { Shield, Eye, EyeOff, Trash2 } from 'lucide-react'
import { Switch } from '@renderer/components/ui/switch'
import { Label } from '@renderer/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@renderer/components/ui/radio-group'
import { useSettingsStore } from '@renderer/store/settings.store'
import type { AppPreferences } from '@shared/types'

type RedactionLevel = AppPreferences['redactionLevel']

const REDACTION_OPTIONS: {
  value: RedactionLevel
  label: string
  description: string
  icon: React.ReactNode
}[] = [
  {
    value: 'none',
    label: 'None',
    description: 'Display secrets as-is. Not recommended.',
    icon: <Eye className="h-4 w-4 text-destructive" />,
  },
  {
    value: 'mask',
    label: 'Mask',
    description: 'Show first/last 4 chars with ●●●● in between.',
    icon: <EyeOff className="h-4 w-4 text-amber-500" />,
  },
  {
    value: 'remove',
    label: 'Remove',
    description: 'Replace entire secret value with [REDACTED].',
    icon: <Trash2 className="h-4 w-4 text-green-500" />,
  },
]

export default function SecuritySettings(): React.JSX.Element {
  const { prefs, updatePref } = useSettingsStore()

  return (
    <div className="space-y-6">
      {/* Secret scanning toggle */}
      <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
        <div className="flex gap-3">
          <Shield className="h-5 w-5 mt-0.5 text-primary shrink-0" />
          <div>
            <Label htmlFor="secret-scan-toggle" className="text-sm font-medium cursor-pointer">
              Real-time secret scanning
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Scan session files for leaked API keys, tokens, and credentials as they are written.
            </p>
          </div>
        </div>
        <Switch
          id="secret-scan-toggle"
          checked={prefs.secretScanEnabled}
          onCheckedChange={(v) => updatePref('secretScanEnabled', v)}
        />
      </div>

      {/* Redaction level */}
      <div>
        <Label className="text-sm font-medium mb-1 block">Secret redaction level</Label>
        <p className="text-xs text-muted-foreground mb-3">
          How detected secrets are displayed in the session viewer.
        </p>
        <RadioGroup
          value={prefs.redactionLevel}
          onValueChange={(v) => updatePref('redactionLevel', v as RedactionLevel)}
          className="space-y-2"
        >
          {REDACTION_OPTIONS.map((opt) => (
            <Label key={opt.value} htmlFor={`redact-${opt.value}`} className="cursor-pointer">
              <div
                className={`
                flex items-center gap-3 rounded-lg border p-3 transition-colors
                ${
                  prefs.redactionLevel === opt.value
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-muted/40'
                }
              `}
              >
                {opt.icon}
                <div className="flex-1">
                  <p className="text-sm font-medium">{opt.label}</p>
                  <p className="text-xs text-muted-foreground">{opt.description}</p>
                </div>
                <RadioGroupItem value={opt.value} id={`redact-${opt.value}`} />
              </div>
            </Label>
          ))}
        </RadioGroup>
      </div>
    </div>
  )
}
