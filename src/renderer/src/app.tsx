import React, { useEffect } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/query-client'
import { useSettingsStore } from './store/settings.store'
import { useConfigStore } from './store/config.store'
import { useTheme } from './hooks/use-theme'
import { useFileEvents } from './hooks/use-file-events'
import DashboardShell from './components/layout/dashboard-shell'
import { ErrorBoundary } from './components/shared/error-boundary'
import { ToastProvider } from './components/shared/toast-host'
import { WhatsNewModal } from './components/shared/whats-new-modal'
import { ipc } from './lib/ipc-client'

// Forward renderer-side unhandled errors to the main process for Sentry capture.
// Must run once at module load — before any component mounts.
window.addEventListener('error', (event) => {
  const err = event.error instanceof Error ? event.error : new Error(event.message)
  ipc.sentry.captureException(err.message, err.stack, 'window.onerror').catch(() => {
    /* best-effort */
  })
})
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  const err = reason instanceof Error ? reason : new Error(String(reason))
  ipc.sentry.captureException(err.message, err.stack, 'unhandledrejection').catch(() => {
    /* best-effort */
  })
})

function AppContent(): React.JSX.Element {
  const loadPrefs = useSettingsStore((s) => s.loadPrefs)
  const loadAllConfig = useConfigStore((s) => s.loadAll)

  // Apply theme to <html> element
  useTheme()

  // Wire push events from main process
  useFileEvents()

  // Load preferences and config on first mount. Owning the config fetch here
  // (rather than in each sidebar component) avoids redundant requests when
  // users navigate between sidebars and matches how `useFileEvents` already
  // owns config refresh on file-change events.
  useEffect(() => {
    loadPrefs()
    loadAllConfig()
  }, [loadPrefs, loadAllConfig])

  return (
    <>
      <DashboardShell />
      <WhatsNewModal />
    </>
  )
}

export default function App(): React.JSX.Element {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AppContent />
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
