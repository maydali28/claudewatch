import React, { useState } from 'react'
import { Bell, BellOff } from 'lucide-react'
import { Switch } from '@renderer/components/ui/switch'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Label } from '@renderer/components/ui/label'
import { Input } from '@renderer/components/ui/input'
import { useSettingsStore } from '@renderer/store/settings.store'
import { resolveCostAlertSettings } from '@shared/utils/cost-alert-settings'
import type { AppPreferences } from '@shared/types'
import { NotificationHelp } from './notification-help'

type ToggleKey = 'dailyCostAlertEnabled' | 'sessionCostAlertEnabled'
type AmountKey = 'costAlertThreshold' | 'sessionCostAlertThreshold'

/** One alert type: a checkbox, its USD amount and when it fires. */
function AlertType({
  id,
  title,
  note,
  unit,
  on,
  amount,
  disabled,
  toggleKey,
  amountKey,
  onSave,
}: {
  id: string
  title: string
  note: string
  unit: string
  on: boolean
  amount: number
  disabled: boolean
  toggleKey: ToggleKey
  amountKey: AmountKey
  onSave: (patch: Partial<AppPreferences>) => void
}): React.JSX.Element {
  const [input, setInput] = useState(String(amount))
  const commit = (): void => {
    const val = parseFloat(input)
    if (!isNaN(val) && val > 0) onSave({ [amountKey]: val })
    else setInput(String(amount))
  }
  const dim = disabled || !on

  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3 pl-12">
      <div className="flex items-start gap-2.5">
        <Checkbox
          id={`${id}-check`}
          checked={on}
          disabled={disabled}
          onCheckedChange={(v) => onSave({ [toggleKey]: v === true })}
          className="mt-0.5"
        />
        <div>
          <Label
            htmlFor={`${id}-check`}
            className={`text-sm cursor-pointer ${disabled ? 'text-muted-foreground' : ''}`}
          >
            {title}
          </Label>
          <p className="text-xs text-muted-foreground mt-0.5">{note}</p>
        </div>
      </div>
      <div
        className={`flex shrink-0 items-center gap-1.5 text-sm ${dim ? 'text-muted-foreground' : ''}`}
      >
        <span aria-hidden="true">$</span>
        <Input
          aria-label={`${title} in USD`}
          type="number"
          min="0.01"
          step="1"
          value={input}
          disabled={dim}
          onChange={(e) => setInput(e.target.value)}
          onBlur={commit}
          className="h-8 w-24"
        />
        <span className="w-14 text-xs text-muted-foreground">{unit}</span>
      </div>
    </div>
  )
}

export default function AlertsSettings(): React.JSX.Element {
  const { prefs, updatePrefs } = useSettingsStore()
  const s = resolveCostAlertSettings(prefs)
  const save = (patch: Partial<AppPreferences>): void => void updatePrefs(patch)

  // Turning the master on with nothing chosen picks the daily budget, so the
  // switch never reads "on" while nothing can fire.
  const setEnabled = (on: boolean): void =>
    save(
      on && !s.daily.on && !s.session.on
        ? { costAlertsEnabled: true, dailyCostAlertEnabled: true }
        : { costAlertsEnabled: on }
    )

  return (
    <div className="space-y-3">
      <div className="divide-y rounded-lg border">
        <div className="flex items-start justify-between gap-4 p-4">
          <div className="flex gap-3">
            {s.enabled ? (
              <Bell className="h-5 w-5 mt-0.5 text-primary shrink-0" />
            ) : (
              <BellOff className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
            )}
            <div>
              <Label htmlFor="cost-alerts-toggle" className="text-sm font-medium cursor-pointer">
                Cost alerts
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Warn when estimated spend passes a limit you set.
              </p>
            </div>
          </div>
          <Switch id="cost-alerts-toggle" checked={s.enabled} onCheckedChange={setEnabled} />
        </div>

        <AlertType
          id="daily-alert"
          title="Daily budget"
          note="Today’s spend across every session. Once per day."
          unit="/ day"
          on={s.daily.on}
          amount={s.daily.amount}
          disabled={!s.enabled}
          toggleKey="dailyCostAlertEnabled"
          amountKey="costAlertThreshold"
          onSave={save}
        />
        <AlertType
          id="session-alert"
          title="Session cost limit"
          note="One session’s cost. Once per session; sessions already over it at launch are not reported."
          unit="/ session"
          on={s.session.on}
          amount={s.session.amount}
          disabled={!s.enabled}
          toggleKey="sessionCostAlertEnabled"
          amountKey="sessionCostAlertThreshold"
          onSave={save}
        />

        <div className="flex items-start justify-between gap-4 px-4 py-3 pl-12">
          <div>
            <Label
              htmlFor="cost-notify-toggle"
              className={`text-sm cursor-pointer ${s.enabled ? '' : 'text-muted-foreground'}`}
            >
              Also show a system notification
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              When ClaudeWatch is in the background. Alerts always show in the app.
            </p>
            {s.enabled && s.notify && <NotificationHelp />}
          </div>
          <Switch
            id="cost-notify-toggle"
            checked={s.enabled && s.notify}
            disabled={!s.enabled}
            onCheckedChange={(v) => save({ costAlertNotify: v })}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Costs are estimates.</p>
    </div>
  )
}
