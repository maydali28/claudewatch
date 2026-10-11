import React, { useState } from 'react'
import { AlertTriangle, Settings2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { ipc } from '@renderer/lib/ipc-client'
import { ipcCall } from '@renderer/lib/ipc-call'
import { useNotificationStatus } from '@renderer/hooks/use-notification-status'

/**
 * Under an "Also show a system notification" switch: when the system has
 * ClaudeWatch's notifications off (macOS is asked directly; elsewhere it is
 * learned from a refused one), a warning with a way to the settings; while
 * still unknown, a test, which on macOS also brings up the permission prompt.
 */
export function NotificationHelp(): React.JSX.Element | null {
  const status = useNotificationStatus()
  const [sent, setSent] = useState(false)

  const sendTest = async (): Promise<void> => {
    const result = await ipcCall(() => ipc.notifications.test(), {
      errorMessage: 'Could not send the test notification',
    })
    if (result.ok) setSent(true)
  }
  const openSettings = (): void => {
    void ipcCall(() => ipc.notifications.openSettings(), {
      errorMessage: 'Could not open the notification settings',
    })
  }

  if (status === 'allowed') return null
  if (status === 'unsupported') {
    return <p className="mt-2 text-xs text-muted-foreground">This system has no notifications.</p>
  }
  if (status === 'unknown') {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        {sent ? (
          'Test sent. Nothing showed? Your system may be blocking it.'
        ) : (
          <>
            Not sure they show?{' '}
            <button
              type="button"
              onClick={() => void sendTest()}
              className="text-foreground underline-offset-2 hover:underline"
            >
              Send a test
            </button>
          </>
        )}
      </p>
    )
  }
  return (
    <div className="mt-2 flex items-center justify-between gap-3 rounded-md border !border-amber-500/30 bg-amber-500/5 p-2.5">
      <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Notifications are off for{' '}
          {import.meta.env.DEV ? 'Electron (this dev build)' : 'ClaudeWatch'} in System Settings.
          Alerts still show in the app.
        </span>
      </p>
      <Button variant="outline" size="sm" onClick={openSettings} className="shrink-0 gap-1.5">
        <Settings2 className="h-3.5 w-3.5" />
        Open notification settings
      </Button>
    </div>
  )
}
