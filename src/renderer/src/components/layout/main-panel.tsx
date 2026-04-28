import React, { useEffect } from 'react'
import { useUIStore, type ViewId } from '@renderer/store/ui.store'
import { useFeatureFlags } from '@renderer/store/feature-flags.store'

// Panel components
import AnalyticsPanel from '@renderer/components/analytics/analytics-panel'
import SessionPanel from '@renderer/components/sessions/session-panel'
import PlansPanel from '@renderer/components/plans/plans-panel'
import TimelinePanel from '@renderer/components/timeline/timeline-panel'
import HooksPanel from '@renderer/components/config/hooks-panel'
import CommandsPanel from '@renderer/components/config/commands-panel'
import SkillsPanel from '@renderer/components/config/skills-panel'
import McpsPanel from '@renderer/components/config/mcps-panel'
import MemoryPanel from '@renderer/components/config/memory-panel'
import LintPanel from '@renderer/components/lint/lint-panel'
import SettingsPanel from '@renderer/components/settings/settings-panel'

function PanelContent({ view }: { view: ViewId }): React.JSX.Element {
  switch (view) {
    case 'analytics':
      return <AnalyticsPanel />
    case 'sessions':
      return <SessionPanel />
    case 'plans':
      return <PlansPanel />
    case 'timeline':
      return <TimelinePanel />
    case 'hooks':
      return <HooksPanel />
    case 'commands':
      return <CommandsPanel />
    case 'skills':
      return <SkillsPanel />
    case 'mcps':
      return <McpsPanel />
    case 'memory':
      return <MemoryPanel />
    case 'lint':
      return <LintPanel />
    case 'settings':
      return <SettingsPanel />
    default:
      return (
        <div className="flex h-full items-center justify-center text-muted-foreground">
          Unknown view.
        </div>
      )
  }
}

export default function MainPanel(): React.JSX.Element {
  const activeView = useUIStore((s) => s.activeView)
  const setView = useUIStore((s) => s.setView)
  const flags = useFeatureFlags()

  useEffect(() => {
    if (activeView === 'timeline' && !flags.timeline) setView('analytics')
    if (activeView === 'lint' && !flags.lint) setView('analytics')
  }, [activeView, flags.timeline, flags.lint, setView])

  return (
    <main className="flex flex-1 flex-col overflow-auto bg-background">
      <PanelContent view={activeView} />
    </main>
  )
}
