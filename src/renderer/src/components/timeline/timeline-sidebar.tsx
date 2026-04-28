import React from 'react'
import { cn } from '@renderer/lib/cn'
import { useSessionsStore } from '@renderer/store/sessions.store'

interface Props {
  selectedDate: string
  onSelectDate: (d: string) => void
}

function getLast7Days(): string[] {
  const days: string[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    days.push(d.toISOString().slice(0, 10))
  }
  return days
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

export default function TimelineSidebar({ selectedDate, onSelectDate }: Props): React.JSX.Element {
  const projects = useSessionsStore((s) => s.projects)
  const days = getLast7Days()

  const sessionDates = new Set<string>()
  for (const project of projects) {
    for (const session of project.sessions) {
      sessionDates.add(session.firstTimestamp.slice(0, 10))
      sessionDates.add(session.lastTimestamp.slice(0, 10))
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Timeline
        </span>
      </div>

      {/* Day list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {days.map((date) => {
          const d = new Date(date + 'T00:00:00')
          const hasSessions = sessionDates.has(date)
          const isSelected = selectedDate === date
          const isToday = date === new Date().toISOString().slice(0, 10)

          return (
            <button
              key={date}
              onClick={() => onSelectDate(date)}
              className={cn(
                'w-full flex items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors',
                isSelected ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-accent'
              )}
            >
              <div className="text-center w-8 shrink-0">
                <div className="text-[10px] uppercase tracking-wide leading-none mb-0.5 text-muted-foreground">
                  {DAY_LABELS[d.getDay()]}
                </div>
                <div
                  className={cn(
                    'text-lg font-bold leading-none',
                    isToday ? 'text-primary' : isSelected ? 'text-primary' : 'text-foreground'
                  )}
                >
                  {d.getDate()}
                </div>
              </div>

              <div className="flex-1 text-left min-w-0">
                <p
                  className={cn(
                    'text-xs font-medium',
                    isSelected ? 'text-primary' : 'text-foreground'
                  )}
                >
                  {MONTH_SHORT[d.getMonth()]} {d.getFullYear()}
                </p>
                {isToday && <p className="text-[10px] text-muted-foreground">Today</p>}
              </div>

              {hasSessions && (
                <div
                  className={cn(
                    'h-1.5 w-1.5 rounded-full shrink-0',
                    isSelected ? 'bg-primary' : 'bg-primary/60'
                  )}
                />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
