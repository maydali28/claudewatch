import React, { useState, useCallback, useEffect, useRef } from 'react'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import SettingsSidebar, { type SettingsSection } from './settings-sidebar'
import AppearanceSettings from './appearance-settings'
import PricingSettings from './pricing-settings'
import ModelsSettings from './models-settings'
import ClaudeFolderSettings from './claude-folder-settings'
import SecuritySettings from './security-settings'
import AlertsSettings from './alerts-settings'
import PrivacySettings from './privacy-settings'
import AboutPanel from './about-panel'
import { useUIStore } from '@renderer/store/ui.store'
import { cn } from '@renderer/lib/cn'

const SECTION_TITLES: Record<SettingsSection, string> = {
  appearance: 'Appearance',
  'claude-folder': 'Claude folder',
  pricing: 'Pricing',
  models: 'Models',
  security: 'Security',
  alerts: 'Alerts',
  privacy: 'Privacy',
  about: 'About',
}

function SectionContent({ section }: { section: SettingsSection }) {
  switch (section) {
    case 'appearance':
      return <AppearanceSettings />
    case 'claude-folder':
      return <ClaudeFolderSettings />
    case 'pricing':
      return <PricingSettings />
    case 'models':
      return <ModelsSettings />
    case 'security':
      return <SecuritySettings />
    case 'alerts':
      return <AlertsSettings />
    case 'privacy':
      return <PrivacySettings />
    case 'about':
      return <AboutPanel />
  }
}

export default function SettingsPanel(): React.JSX.Element {
  const [section, setSection] = useState<SettingsSection>('appearance')
  const sidebarWidth = useUIStore((s) => s.sidebarWidth)
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth)
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
        setSidebarWidth(Math.max(180, Math.min(400, startWidth + delta)))
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

  return (
    <div className="flex h-full">
      {/* Inner nav */}
      <div
        className="relative shrink-0 border-r bg-muted/20 overflow-hidden flex flex-col"
        style={{ width: sidebarWidth }}
      >
        <SettingsSidebar active={section} onChange={setSection} />
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

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="max-w-2xl mx-auto p-6">
          <h2 className="text-xl font-semibold mb-1">{SECTION_TITLES[section]}</h2>
          <div className="h-px bg-border mb-6" />
          <SectionContent section={section} />
        </div>
      </ScrollArea>
    </div>
  )
}
