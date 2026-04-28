import React, { useEffect } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/query-client'
import { useSettingsStore } from './store/settings.store'
import { useTheme } from './hooks/use-theme'
import AboutWindow from './components/about/about-window'

function AboutAppContent(): React.JSX.Element {
  const loadPrefs = useSettingsStore((s) => s.loadPrefs)
  useTheme()
  useEffect(() => {
    loadPrefs()
  }, [loadPrefs])
  return <AboutWindow />
}

export default function AboutApp(): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <AboutAppContent />
    </QueryClientProvider>
  )
}
