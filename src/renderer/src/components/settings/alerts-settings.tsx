import React, { useState } from 'react'
import { Bell, BellOff } from 'lucide-react'
import { Switch } from '@renderer/components/ui/switch'
import { Label } from '@renderer/components/ui/label'
import { Input } from '@renderer/components/ui/input'
import { useSettingsStore } from '@renderer/store/settings.store'

type ThresholdKey = 'costAlertThreshold' | 'sessionCostAlertThreshold'

/**
 * One alert: a switch and its USD threshold. Off is stored as 0, not
 * removed: the settings store cannot save `undefined`.
 */
function ThresholdAlert({
  prefKey,
  id,
  title,
  description,
  unit,
  note,
  fallback,
}: {
  prefKey: ThresholdKey
  id: string
  title: string
  description: string
  unit: string
  note: string
  fallback: number
}): React.JSX.Element {
  const { prefs, updatePref } = useSettingsStore()
  const stored = prefs[prefKey]
  const enabled = stored !== undefined && stored > 0
  const [input, setInput] = useState(String(enabled ? stored : fallback))

  function handleToggle(on: boolean): void {
    const val = parseFloat(input)
    void updatePref(prefKey, on ? (isNaN(val) || val <= 0 ? fallback : val) : 0)
  }

  function handleCommit(): void {
    const val = parseFloat(input)
    if (!isNaN(val) && val > 0) void updatePref(prefKey, val)
    else setInput(String(enabled ? stored : fallback))
  }

  return (
    <div className="flex items-start justify-between gap-4 p-4">
      <div className="flex gap-3">
        {enabled ? (
          <Bell className="h-5 w-5 mt-0.5 text-primary shrink-0" />
        ) : (
          <BellOff className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
        )}
        <div>
          <Label htmlFor={`${id}-toggle`} className="text-sm font-medium cursor-pointer">
            {title}
          </Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            {description} {note}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <div
          className={`flex items-center gap-1.5 text-sm ${enabled ? '' : 'text-muted-foreground'}`}
        >
          <span aria-hidden="true">$</span>
          <Input
            id={`${id}-input`}
            aria-label={`${title} threshold in USD`}
            type="number"
            min="0.01"
            step="1"
            value={input}
            disabled={!enabled}
            onChange={(e) => setInput(e.target.value)}
            onBlur={handleCommit}
            className="h-8 w-24"
            placeholder={String(fallback)}
          />
          <span className="text-xs text-muted-foreground">{unit}</span>
        </div>
        <Switch id={`${id}-toggle`} checked={enabled} onCheckedChange={handleToggle} />
      </div>
    </div>
  )
}

export default function AlertsSettings(): React.JSX.Element {
  return (
    <div className="space-y-3">
      <div className="divide-y rounded-lg border">
        <ThresholdAlert
          prefKey="costAlertThreshold"
          id="daily-alert"
          title="Daily budget"
          description="Warn when today’s estimated spend, across every session, passes the budget."
          unit="/ day"
          note="Once per day."
          fallback={25}
        />
        <ThresholdAlert
          prefKey="sessionCostAlertThreshold"
          id="session-alert"
          title="Session cost limit"
          description="Warn when a single session’s estimated cost passes the limit."
          unit="/ session"
          note="Once per session; sessions already over it when ClaudeWatch starts are not reported."
          fallback={10}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Alerts show in the app, and as a system notification when ClaudeWatch is in the background.
        Costs are estimates.
      </p>
    </div>
  )
}
