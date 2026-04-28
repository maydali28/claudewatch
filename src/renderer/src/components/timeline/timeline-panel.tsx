import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { CalendarDays } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@renderer/components/ui/tooltip'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { useSessionsStore } from '@renderer/store/sessions.store'
import { useUIStore } from '@renderer/store/ui.store'
import { formatCost } from '@shared/utils'
import { cn } from '@renderer/lib/cn'
import { EmptyState } from '@renderer/components/shared/empty-state'
import type { SessionSummary } from '@shared/types'
import TimelineSidebar from './timeline-sidebar'

// ── Consistent project colour by hashing project id ──────────────────────────

const PROJECT_COLOURS = [
  'bg-blue-500/70 border-blue-600',
  'bg-violet-500/70 border-violet-600',
  'bg-emerald-500/70 border-emerald-600',
  'bg-amber-500/70 border-amber-600',
  'bg-rose-500/70 border-rose-600',
  'bg-cyan-500/70 border-cyan-600',
  'bg-fuchsia-500/70 border-fuchsia-600',
  'bg-orange-500/70 border-orange-600',
]

function projectColor(projectId: string): string {
  let hash = 0
  for (let i = 0; i < projectId.length; i++) hash = (hash * 31 + projectId.charCodeAt(i)) | 0
  return PROJECT_COLOURS[Math.abs(hash) % PROJECT_COLOURS.length]
}

// ── Session block geometry ────────────────────────────────────────────────────

const HOUR_HEIGHT_PX = 64

interface SessionBlock {
  session: SessionSummary
  projectName: string
  startMinutes: number
  durationMinutes: number
  colour: string
}

function toMinutes(isoStr: string, baseDate: string): number {
  const d = new Date(isoStr)
  const base = new Date(baseDate + 'T00:00:00')
  return (d.getTime() - base.getTime()) / 60_000
}

function buildBlocks(
  sessions: SessionSummary[],
  projectNameMap: Record<string, string>,
  date: string
): SessionBlock[] {
  return sessions
    .filter((s) => {
      const start = s.firstTimestamp.slice(0, 10)
      const end = s.lastTimestamp.slice(0, 10)
      return start === date || end === date
    })
    .map((s) => {
      const startMin = Math.max(0, toMinutes(s.firstTimestamp, date))
      const endMin = Math.min(24 * 60, toMinutes(s.lastTimestamp, date))
      return {
        session: s,
        projectName: projectNameMap[s.projectId] ?? s.projectId,
        startMinutes: startMin,
        durationMinutes: Math.max(endMin - startMin, 5),
        colour: projectColor(s.projectId),
      }
    })
}

// ── Component ─────────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

const MIN_WIDTH = 180
const MAX_WIDTH = 400

export default function TimelinePanel(): React.JSX.Element {
  const projects = useSessionsStore((s) => s.projects)
  const setView = useUIStore((s) => s.setView)
  const setActiveSession = useSessionsStore((s) => s.setActiveSession)
  const setActiveProject = useSessionsStore((s) => s.setActiveProject)
  const sidebarWidth = useUIStore((s) => s.sidebarWidth)
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth)

  const [selectedDate, setSelectedDate] = useState(todayStr())
  const [isResizing, setIsResizing] = useState(false)
  const sidebarWidthRef = useRef(sidebarWidth)
  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth
  }, [sidebarWidth])

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
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

  const allSessions = useMemo(() => projects.flatMap((p) => p.sessions), [projects])

  const projectNameMap = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.id, p.name])),
    [projects]
  )

  const blocks = useMemo(
    () => buildBlocks(allSessions, projectNameMap, selectedDate),
    [allSessions, projectNameMap, selectedDate]
  )

  function handleSessionClick(block: SessionBlock) {
    setActiveProject(block.session.projectId)
    setActiveSession(block.session.id)
    setView('sessions')
  }

  const dateLabel = new Date(selectedDate + 'T12:00:00').toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full">
        {/* Inner date sidebar */}
        <div
          className="relative shrink-0 border-r bg-muted/20 overflow-hidden flex flex-col"
          style={{ width: sidebarWidth }}
        >
          <TimelineSidebar selectedDate={selectedDate} onSelectDate={setSelectedDate} />
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

        {/* Time gutter + session blocks */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="border-b px-4 py-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">{dateLabel}</h2>
            <span className="text-xs text-muted-foreground">
              {blocks.length} session{blocks.length !== 1 ? 's' : ''}
            </span>
          </div>

          {blocks.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No sessions on this day"
              description="Select a different date to view sessions"
            />
          ) : (
            <ScrollArea className="flex-1">
              <div className="relative flex" style={{ height: 24 * HOUR_HEIGHT_PX }}>
                {/* Hour labels */}
                <div className="w-14 shrink-0 relative select-none">
                  {Array.from({ length: 24 }, (_, h) => (
                    <div
                      key={h}
                      className="absolute text-[10px] text-muted-foreground/60 right-2 leading-none"
                      style={{ top: h * HOUR_HEIGHT_PX - 6 }}
                    >
                      {h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`}
                    </div>
                  ))}
                </div>

                {/* Grid lines + blocks */}
                <div className="relative flex-1 border-l">
                  {/* Hour grid lines */}
                  {Array.from({ length: 24 }, (_, h) => (
                    <div
                      key={h}
                      className="absolute left-0 right-0 border-t border-border/40"
                      style={{ top: h * HOUR_HEIGHT_PX }}
                    />
                  ))}

                  {/* Session blocks */}
                  {blocks.map((block) => {
                    const top = (block.startMinutes / 60) * HOUR_HEIGHT_PX
                    const height = Math.max((block.durationMinutes / 60) * HOUR_HEIGHT_PX, 20)

                    return (
                      <Tooltip key={block.session.id}>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => handleSessionClick(block)}
                            className={`
                              absolute left-2 right-4 rounded border text-left overflow-hidden
                              transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary
                              ${block.colour}
                            `}
                            style={{ top, height }}
                          >
                            <div className="px-2 py-1 h-full flex flex-col justify-start overflow-hidden">
                              <p className="text-[11px] font-semibold text-white leading-tight truncate">
                                {block.session.title}
                              </p>
                              {height > 32 && (
                                <p className="text-[10px] text-white/80 truncate">
                                  {block.projectName}
                                </p>
                              )}
                            </div>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-56 space-y-1">
                          <p className="font-semibold text-sm">{block.session.title}</p>
                          <p className="text-xs text-muted-foreground">{block.projectName}</p>
                          <div className="flex gap-3 text-xs">
                            <span>{formatCost(block.session.estimatedCost)}</span>
                            {block.session.primaryModel && (
                              <span className="text-muted-foreground">
                                {block.session.primaryModel}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">Click to open in Sessions</p>
                        </TooltipContent>
                      </Tooltip>
                    )
                  })}
                </div>
              </div>
            </ScrollArea>
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}
