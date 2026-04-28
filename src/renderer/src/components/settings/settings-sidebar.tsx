import React from 'react'
import { Palette, DollarSign, Shield, Bell, Lock, Info } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { useFeatureFlags } from '@renderer/store/feature-flags.store'
import type { FeatureFlags } from '@shared/constants/feature-flags'

export type SettingsSection = 'appearance' | 'pricing' | 'security' | 'alerts' | 'privacy' | 'about'

interface Props {
  active: SettingsSection
  onChange: (s: SettingsSection) => void
}

const ALL_SECTIONS: {
  id: SettingsSection
  label: string
  icon: React.ReactNode
  flag?: keyof FeatureFlags
}[] = [
  { id: 'appearance', label: 'Appearance', icon: <Palette className="h-4 w-4" /> },
  { id: 'pricing', label: 'Pricing', icon: <DollarSign className="h-4 w-4" /> },
  { id: 'security', label: 'Security', icon: <Shield className="h-4 w-4" />, flag: 'lint' },
  { id: 'alerts', label: 'Alerts', icon: <Bell className="h-4 w-4" />, flag: 'costAlerts' },
  { id: 'privacy', label: 'Privacy', icon: <Lock className="h-4 w-4" /> },
  { id: 'about', label: 'About', icon: <Info className="h-4 w-4" /> },
]

export default function SettingsSidebar({ active, onChange }: Props): React.JSX.Element {
  const flags = useFeatureFlags()
  const sections = ALL_SECTIONS.filter((s) => !s.flag || flags[s.flag])

  return (
    <div className="flex flex-col gap-0.5 p-2">
      <p className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Settings
      </p>
      {sections.map((s) => (
        <button
          key={s.id}
          onClick={() => onChange(s.id)}
          className={cn(
            'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors w-full text-left',
            active === s.id
              ? 'bg-accent text-accent-foreground font-medium'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
          )}
        >
          {s.icon}
          {s.label}
        </button>
      ))}
    </div>
  )
}
