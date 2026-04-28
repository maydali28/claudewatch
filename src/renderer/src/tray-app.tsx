import React, { useEffect } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/query-client'
import { useSettingsStore } from './store/settings.store'
import { useTheme } from './hooks/use-theme'
import TrayPopover from './components/tray-popover/tray-popover'

function TrayAppContent(): React.JSX.Element {
  const loadPrefs = useSettingsStore((s) => s.loadPrefs)

  useTheme()

  useEffect(() => {
    loadPrefs()
  }, [loadPrefs])

  return <TrayPopover />
}

export default function TrayApp(): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <TrayAppContent />
    </QueryClientProvider>
  )
}
