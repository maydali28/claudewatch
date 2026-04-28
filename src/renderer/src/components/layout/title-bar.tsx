import React from 'react'
import { cn } from '@renderer/lib/cn'

const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')

export default function TitleBar(): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex h-8 shrink-0 items-center select-none',
        'bg-background border-b border-border'
      )}
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {isMac && <div className="w-[72px] shrink-0" />}

      <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase px-3">
        ClaudeWatch
      </span>
    </div>
  )
}
