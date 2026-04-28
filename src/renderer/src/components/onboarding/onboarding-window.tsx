import React, { useEffect, useState } from 'react'
import { Rocket, Check } from 'lucide-react'
import { ipc } from '@renderer/lib/ipc-client'
import { CHANNELS } from '@shared/ipc/channels'
import { cn } from '@renderer/lib/cn'

interface OnboardingState {
  launchAtLogin: boolean
}

export default function OnboardingWindow(): React.JSX.Element {
  const [launchAtLogin, setLaunchAtLogin] = useState(false)
  const [toggling, setToggling] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.claudewatch) return
    const unsub = ipc.on<OnboardingState>(CHANNELS.PUSH_SHOW_ONBOARDING, ({ launchAtLogin }) => {
      setLaunchAtLogin(launchAtLogin)
    })
    return unsub
  }, [])

  async function handleToggle(): Promise<void> {
    setToggling(true)
    const next = !launchAtLogin
    setLaunchAtLogin(next)
    await ipc.settings.set({ launchAtLogin: next })
    setToggling(false)
  }

  async function handleDismiss(): Promise<void> {
    await ipc.settings.set({ trayTipDismissed: true })
    window.close()
  }

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground">
      {/* macOS traffic-light drag area */}
      <div className="h-8 shrink-0 [-webkit-app-region:drag]" />

      <div className="flex flex-col flex-1 px-6 pb-6 gap-5 min-h-0">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Rocket className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-bold">Welcome to ClaudeWatch</p>
            <p className="text-xs text-muted-foreground">One quick setup tip</p>
          </div>
        </div>

        {/* Body */}
        <p className="text-sm text-muted-foreground leading-relaxed">
          Enable launch at login so ClaudeWatch starts automatically and monitors your sessions
          without you having to remember to open it.
        </p>

        {/* Toggle */}
        <button
          onClick={handleToggle}
          disabled={toggling}
          className={cn(
            'w-full flex items-center justify-between gap-2 h-10 px-4 rounded-xl text-sm font-medium transition-colors',
            launchAtLogin
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-muted text-foreground hover:bg-accent',
            toggling && 'opacity-60 cursor-not-allowed'
          )}
        >
          <span>Launch at login</span>
          <span
            className={cn(
              'h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors',
              launchAtLogin
                ? 'bg-primary-foreground border-primary-foreground'
                : 'border-muted-foreground'
            )}
          >
            {launchAtLogin && <Check className="h-3 w-3 text-primary" />}
          </span>
        </button>

        {/* Footer */}
        <button
          onClick={handleDismiss}
          className="w-full h-9 rounded-xl text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors mt-auto"
        >
          {launchAtLogin ? 'Done' : 'Maybe later'}
        </button>
      </div>
    </div>
  )
}
