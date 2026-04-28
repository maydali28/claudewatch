import React from 'react'
import { Monitor, Sun, Moon } from 'lucide-react'
import { RadioGroup, RadioGroupItem } from '@renderer/components/ui/radio-group'
import { Label } from '@renderer/components/ui/label'
import { Switch } from '@renderer/components/ui/switch'
import { useSettingsStore } from '@renderer/store/settings.store'
import { useUIStore } from '@renderer/store/ui.store'
import type { Theme } from '@renderer/store/ui.store'

const THEMES: { value: Theme; label: string; icon: React.ReactNode }[] = [
  { value: 'system', label: 'System', icon: <Monitor className="h-5 w-5" /> },
  { value: 'light', label: 'Light', icon: <Sun className="h-5 w-5" /> },
  { value: 'dark', label: 'Dark', icon: <Moon className="h-5 w-5" /> },
]

export default function AppearanceSettings(): React.JSX.Element {
  const { prefs, updatePref } = useSettingsStore()
  const { setTheme } = useUIStore()

  function handleThemeChange(value: string) {
    const t = value as Theme
    updatePref('theme', t)
    setTheme(t)
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold mb-1">Startup</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Control how ClaudeWatch behaves when your device starts.
        </p>
        <div className="flex items-center justify-between">
          <Label htmlFor="launch-at-login" className="cursor-pointer">
            <span className="text-sm font-medium">Launch at login</span>
            <p className="text-xs text-muted-foreground">
              Start ClaudeWatch automatically when you log in
            </p>
          </Label>
          <Switch
            id="launch-at-login"
            checked={prefs.launchAtLogin}
            onCheckedChange={(checked) => updatePref('launchAtLogin', checked)}
          />
        </div>
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-1">Theme</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Choose how Claudewatch looks. System follows your OS preference.
        </p>
        <RadioGroup
          value={prefs.theme}
          onValueChange={handleThemeChange}
          className="grid grid-cols-3 gap-3"
        >
          {THEMES.map((t) => (
            <Label key={t.value} htmlFor={`theme-${t.value}`} className="cursor-pointer">
              <div
                className={`
                flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors
                ${
                  prefs.theme === t.value
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-muted-foreground/40'
                }
              `}
              >
                {t.icon}
                <span className="text-sm font-medium">{t.label}</span>
                <RadioGroupItem value={t.value} id={`theme-${t.value}`} className="sr-only" />
              </div>
            </Label>
          ))}
        </RadioGroup>
      </div>
    </div>
  )
}
