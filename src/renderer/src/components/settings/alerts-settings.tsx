import React, { useState } from 'react'
import { Bell, BellOff } from 'lucide-react'
import { Switch } from '@renderer/components/ui/switch'
import { Label } from '@renderer/components/ui/label'
import { Input } from '@renderer/components/ui/input'
import { useSettingsStore } from '@renderer/store/settings.store'

export default function AlertsSettings(): React.JSX.Element {
  const { prefs, updatePref } = useSettingsStore()
  const alertsEnabled = prefs.costAlertThreshold !== undefined && prefs.costAlertThreshold > 0
  const [thresholdInput, setThresholdInput] = useState(
    prefs.costAlertThreshold !== undefined ? String(prefs.costAlertThreshold) : '25'
  )

  function handleToggle(enabled: boolean) {
    if (enabled) {
      const val = parseFloat(thresholdInput)
      updatePref('costAlertThreshold', isNaN(val) || val <= 0 ? 25 : val)
    } else {
      updatePref('costAlertThreshold', undefined)
    }
  }

  function handleThresholdCommit() {
    const val = parseFloat(thresholdInput)
    if (!isNaN(val) && val > 0) {
      updatePref('costAlertThreshold', val)
    } else {
      setThresholdInput(String(prefs.costAlertThreshold ?? 25))
    }
  }

  return (
    <div className="space-y-6">
      {/* Daily cost alert */}
      <div className="rounded-lg border p-4 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3">
            {alertsEnabled ? (
              <Bell className="h-5 w-5 mt-0.5 text-primary shrink-0" />
            ) : (
              <BellOff className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
            )}
            <div>
              <Label htmlFor="alerts-toggle" className="text-sm font-medium cursor-pointer">
                Daily cost alerts
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Show a notification when your daily spend exceeds the threshold.
              </p>
            </div>
          </div>
          <Switch id="alerts-toggle" checked={alertsEnabled} onCheckedChange={handleToggle} />
        </div>

        {alertsEnabled && (
          <div className="space-y-1.5">
            <Label htmlFor="threshold-input" className="text-sm">
              Alert threshold (USD)
            </Label>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm">$</span>
              <Input
                id="threshold-input"
                type="number"
                min="0.01"
                step="1"
                value={thresholdInput}
                onChange={(e) => setThresholdInput(e.target.value)}
                onBlur={handleThresholdCommit}
                className="w-32"
                placeholder="25"
              />
              <span className="text-xs text-muted-foreground">per day</span>
            </div>
            <p className="text-xs text-muted-foreground">
              You will be notified once per day when this limit is exceeded.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
