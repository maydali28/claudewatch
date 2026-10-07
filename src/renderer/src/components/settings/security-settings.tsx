import React, { useState } from 'react'
import { Shield, Eye, EyeOff, Trash2, BellRing, Settings2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Switch } from '@renderer/components/ui/switch'
import { Label } from '@renderer/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@renderer/components/ui/radio-group'
import { useSettingsStore } from '@renderer/store/settings.store'
import { ipc } from '@renderer/lib/ipc-client'
import { ipcCall } from '@renderer/lib/ipc-call'
import type { AppPreferences } from '@shared/types'
import { SecretFindingsList } from './secret-findings-list'

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
    description: 'Keep the first and last 4 characters: sk-a****9f3c.',
    icon: <EyeOff className="h-4 w-4 text-amber-500" />,
  },
  {
    value: 'remove',
    label: 'Remove',
    description: 'Replace the whole secret with [REDACTED]. A private key is hidden whole.',
    icon: <Trash2 className="h-4 w-4 text-green-500" />,
  },
]

/**
 * Development builds only: sends a sample alert at once, to check that the OS
 * shows ClaudeWatch's notifications. A dev build notifies as "Electron", so
 * that is the app to allow in System Settings › Notifications.
 */
function TestNotificationButton(): React.JSX.Element {
  const [status, setStatus] = useState<string | null>(null)
  const send = async (): Promise<void> => {
    const result = await ipcCall(() => ipc.secrets.testNotification(), {
      errorMessage: 'Could not send the test notification',
    })
    if (!result.ok) return
    setStatus(
      result.data.supported
        ? 'Sent. No banner? Open the notification settings, allow “Electron”, and check that Focus is off.'
        : 'This system does not support notifications.'
    )
  }
  const openSettings = async (): Promise<void> => {
    const result = await ipcCall(() => ipc.secrets.openNotificationSettings(), {
      errorMessage: 'Could not open the notification settings',
    })
    if (result.ok && !result.data.opened) {
      setStatus('Open your system settings to allow notifications for “Electron”.')
    }
  }
  return (
    <div className="space-y-2 pt-2">
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void send()}
          className="shrink-0 gap-1.5"
        >
          <BellRing className="h-3.5 w-3.5" />
          Send test notification
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void openSettings()}
          className="shrink-0 gap-1.5"
        >
          <Settings2 className="h-3.5 w-3.5" />
          Open notification settings
        </Button>
      </div>
      {status && <p className="text-xs text-muted-foreground">{status}</p>}
    </div>
  )
}

export default function SecuritySettings(): React.JSX.Element {
  const { prefs, updatePref, updatePrefs } = useSettingsStore()
  const scanningOn = prefs.secretScanEnabled && prefs.secretScanConsent === 'granted'
  // Turning scanning on here is an explicit answer, the same as the prompt's.
  const setScanning = (on: boolean): void => {
    void updatePrefs(
      on
        ? { secretScanEnabled: true, secretScanConsent: 'granted' }
        : { secretScanEnabled: false, secretScanConsent: 'declined' }
    )
  }

  return (
    <div className="space-y-6">
      {/* Secret scanning toggle */}
      <div className="flex items-start justify-between gap-4 rounded-t-lg border p-4">
        <div className="flex gap-3">
          <Shield className="h-5 w-5 mt-0.5 text-primary shrink-0" />
          <div>
            <Label htmlFor="secret-scan-toggle" className="text-sm font-medium cursor-pointer">
              Scan new transcript content for secrets
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Warns you when an API key, token, password or private key lands in a session or one of
              its sub-agents. Runs on this machine and keeps only masked values.
            </p>
          </div>
        </div>
        <Switch id="secret-scan-toggle" checked={scanningOn} onCheckedChange={setScanning} />
      </div>

      <div className="-mt-6 flex items-start justify-between gap-4 rounded-b-lg border border-t-0 px-4 py-3 pl-12">
        <div>
          <Label
            htmlFor="secret-notify-toggle"
            className={`text-sm cursor-pointer ${scanningOn ? '' : 'text-muted-foreground'}`}
          >
            Also show a system notification
          </Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            When ClaudeWatch is in the background. It names the session and the kind of secret,
            never the value.
          </p>
          {import.meta.env.DEV && <TestNotificationButton />}
        </div>
        <Switch
          id="secret-notify-toggle"
          checked={scanningOn && prefs.secretScanNotify}
          disabled={!scanningOn}
          onCheckedChange={(v) => updatePref('secretScanNotify', v)}
        />
      </div>

      <SecretFindingsList />

      {/* Redaction level */}
      <div>
        <Label className="text-sm font-medium mb-1 block">Secret redaction level</Label>
        <p className="text-xs text-muted-foreground mb-3">
          How secrets are shown in the session viewer, sub-agent conversations and exports. Applies
          whether or not scanning is on.
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
