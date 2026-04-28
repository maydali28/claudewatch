import React, { useState } from 'react'
import { X, Rocket, Check } from 'lucide-react'
import { cn } from '@renderer/lib/cn'

interface TrayOnboardingModalProps {
  open: boolean
  launchAtLogin: boolean
  onToggleLaunchAtLogin: (val: boolean) => Promise<void>
  onDismiss: () => void
}

export function TrayOnboardingModal({
  open,
  launchAtLogin,
  onToggleLaunchAtLogin,
  onDismiss,
}: TrayOnboardingModalProps): React.JSX.Element | null {
  const [toggling, setToggling] = useState(false)

  if (!open) return null

  async function handleToggle(): Promise<void> {
    setToggling(true)
    await onToggleLaunchAtLogin(!launchAtLogin)
    setToggling(false)
  }

  return (
    <div
      role="presentation"
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 rounded-xl"
      onClick={onDismiss}
      onKeyDown={(e) => e.key === 'Escape' && onDismiss()}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={cn(
          'relative w-64 rounded-xl border border-border bg-background shadow-xl',
          'flex flex-col overflow-hidden'
        )}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-border/60">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Rocket className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold leading-tight">Welcome to ClaudeWatch</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">One quick setup tip</p>
          </div>
          <button
            onClick={onDismiss}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3 space-y-3">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Enable launch at login so ClaudeWatch starts automatically and monitors your sessions
            without you having to remember to open it.
          </p>

          <button
            onClick={handleToggle}
            disabled={toggling}
            className={cn(
              'w-full flex items-center justify-between gap-2 h-9 px-3 rounded-lg text-[12px] font-medium transition-colors',
              launchAtLogin
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-foreground hover:bg-accent',
              toggling && 'opacity-60 cursor-not-allowed'
            )}
          >
            <span>Launch at login</span>
            <span
              className={cn(
                'h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors',
                launchAtLogin
                  ? 'bg-primary-foreground border-primary-foreground'
                  : 'border-muted-foreground'
              )}
            >
              {launchAtLogin && <Check className="h-2.5 w-2.5 text-primary" />}
            </span>
          </button>
        </div>

        {/* Footer */}
        <div className="px-4 pb-3">
          <button
            onClick={onDismiss}
            className="w-full h-8 rounded-lg text-[12px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            {launchAtLogin ? 'Done' : 'Maybe later'}
          </button>
        </div>
      </div>
    </div>
  )
}
