import React, { useEffect } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/query-client'
import { useSettingsStore } from './store/settings.store'
import { useTheme } from './hooks/use-theme'
import OnboardingWindow from './components/onboarding/onboarding-window'

function OnboardingAppContent(): React.JSX.Element {
  const loadPrefs = useSettingsStore((s) => s.loadPrefs)
  useTheme()
  useEffect(() => {
    loadPrefs()
  }, [loadPrefs])
  return <OnboardingWindow />
}

export default function OnboardingApp(): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <OnboardingAppContent />
    </QueryClientProvider>
  )
}
