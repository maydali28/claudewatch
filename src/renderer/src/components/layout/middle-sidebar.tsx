import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useUIStore, type ViewId } from '@renderer/store/ui.store'
import { cn } from '@renderer/lib/cn'

// Sidebar components
import AnalyticsSidebar from '@renderer/components/analytics/analytics-sidebar'
import SessionsSidebar from '@renderer/components/sessions/sessions-sidebar'
import HooksSidebar from '@renderer/components/config/hooks-sidebar'
import CommandsSidebar from '@renderer/components/config/commands-sidebar'
import SkillsSidebar from '@renderer/components/config/skills-sidebar'
import McpsSidebar from '@renderer/components/config/mcps-sidebar'
import MemorySidebar from '@renderer/components/config/memory-sidebar'
import LintSidebar from '@renderer/components/lint/lint-sidebar'

function SidebarContent({ view }: { view: ViewId }): React.JSX.Element | null {
  if (view === 'analytics') return <AnalyticsSidebar />
  if (view === 'sessions') return <SessionsSidebar />
  if (view === 'hooks') return <HooksSidebar />
  if (view === 'commands') return <CommandsSidebar />
  if (view === 'skills') return <SkillsSidebar />
  if (view === 'mcps') return <McpsSidebar />
  if (view === 'memory') return <MemorySidebar />
  if (view === 'lint') return <LintSidebar />
  return <div className="p-4 text-sm text-muted-foreground">No sidebar for this view.</div>
}

const MIN_WIDTH = 180
const MAX_WIDTH = 400

export default function MiddleSidebar(): React.JSX.Element | null {
  const activeView = useUIStore((s) => s.activeView)
  const sidebarWidth = useUIStore((s) => s.sidebarWidth)
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth)

  const [isResizing, setIsResizing] = useState(false)
  const sidebarWidthRef = useRef(sidebarWidth)
  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth
  }, [sidebarWidth])

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      setIsResizing(true)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      const startX = e.clientX
      const startWidth = sidebarWidthRef.current

      const onMove = (ev: MouseEvent): void => {
        const delta = ev.clientX - startX
        setSidebarWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + delta)))
      }

      const onUp = (): void => {
        setIsResizing(false)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [setSidebarWidth]
  )

  // These panels embed their own full-width layouts with an internal sidebar
  if (activeView === 'settings' || activeView === 'timeline' || activeView === 'plans') return null

  return (
    <div
      className="relative flex shrink-0 flex-col border-r border-border bg-background overflow-hidden"
      style={{ width: sidebarWidth }}
    >
      <div className="flex-1 overflow-y-auto">
        <SidebarContent view={activeView} />
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={onMouseDown}
        className={cn(
          'absolute right-0 top-0 h-full w-1 cursor-col-resize select-none',
          'hover:bg-primary/30 transition-colors',
          isResizing && 'bg-primary/50'
        )}
        aria-hidden
      />
    </div>
  )
}
