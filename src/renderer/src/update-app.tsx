import React, { useEffect } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/query-client'
import { useSettingsStore } from './store/settings.store'
import { useTheme } from './hooks/use-theme'
import UpdateWindow from './components/update/update-window'

function UpdateAppContent(): React.JSX.Element {
  const loadPrefs = useSettingsStore((s) => s.loadPrefs)

  useTheme()

  useEffect(() => {
    loadPrefs()
  }, [loadPrefs])

  return <UpdateWindow />
}

export default function UpdateApp(): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <UpdateAppContent />
    </QueryClientProvider>
  )
}
