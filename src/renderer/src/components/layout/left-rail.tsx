import React from 'react'
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@renderer/components/ui/tooltip'
import {
  BarChart2,
  FileText,
  BookOpen,
  Clock,
  Webhook,
  Terminal,
  Layers,
  Server,
  Brain,
  ShieldCheck,
  Settings,
} from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { useUIStore, type ViewId } from '@renderer/store/ui.store'
import { useFeatureFlags } from '@renderer/store/feature-flags.store'
import type { FeatureFlags } from '@shared/constants/feature-flags'

interface NavItem {
  id: ViewId
  icon: React.ElementType
  label: string
  flag?: keyof FeatureFlags
}

const TOP_ITEMS: NavItem[] = [
  { id: 'analytics', icon: BarChart2, label: 'Analytics' },
  { id: 'sessions', icon: FileText, label: 'Sessions' },
  { id: 'plans', icon: BookOpen, label: 'Plans' },
  { id: 'timeline', icon: Clock, label: 'Timeline', flag: 'timeline' },
  { id: 'hooks', icon: Webhook, label: 'Hooks' },
  { id: 'commands', icon: Terminal, label: 'Commands' },
  { id: 'skills', icon: Layers, label: 'Skills' },
  { id: 'mcps', icon: Server, label: 'MCPs' },
  { id: 'memory', icon: Brain, label: 'Memory' },
  { id: 'lint', icon: ShieldCheck, label: 'Lint', flag: 'lint' },
]

const BOTTOM_ITEM: NavItem = { id: 'settings', icon: Settings, label: 'Settings' }

function NavButton({ item, active }: { item: NavItem; active: boolean }): React.JSX.Element {
  const setView = useUIStore((s) => s.setView)
  const Icon = item.icon

  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>
        <button
          aria-label={item.label}
          onClick={() => setView(item.id)}
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-md outline-none',
            'transition-colors duration-100',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
            active
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          )}
        >
          <Icon size={18} strokeWidth={1.75} />
        </button>
      </TooltipTrigger>

      <TooltipContent side="right" sideOffset={10}>
        {item.label}
      </TooltipContent>
    </Tooltip>
  )
}

export default function LeftRail(): React.JSX.Element {
  const activeView = useUIStore((s) => s.activeView)
  const flags = useFeatureFlags()

  const visibleItems = TOP_ITEMS.filter((item) => !item.flag || flags[item.flag])

  return (
    <TooltipProvider>
      <nav
        className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-border bg-background py-2"
        aria-label="Main navigation"
      >
        <div className="flex flex-1 flex-col items-center gap-1">
          {visibleItems.map((item) => (
            <NavButton key={item.id} item={item} active={activeView === item.id} />
          ))}
        </div>

        <NavButton item={BOTTOM_ITEM} active={activeView === 'settings'} />
      </nav>
    </TooltipProvider>
  )
}
