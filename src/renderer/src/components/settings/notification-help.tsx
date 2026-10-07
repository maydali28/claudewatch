import React, { useState } from 'react'
import { AlertTriangle, BellRing, Settings2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { ipc } from '@renderer/lib/ipc-client'
import { ipcCall } from '@renderer/lib/ipc-call'
import { useNotificationStatus } from '@renderer/hooks/use-notification-status'

/**
 * Under an "Also show a system notification" switch: a way to fix blocked
 * notifications, shown only once one was refused (the OS cannot be asked
 * beforehand), and a test to find out while that is still unknown.
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
    <div className="mt-2 space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
      <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Your system is blocking ClaudeWatch’s notifications. Allow them in its notification
          settings{import.meta.env.DEV ? ' (a dev build is listed as “Electron”)' : ''}.
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={openSettings} className="gap-1.5">
          <Settings2 className="h-3.5 w-3.5" />
          Open notification settings
        </Button>
        <Button variant="outline" size="sm" onClick={() => void sendTest()} className="gap-1.5">
          <BellRing className="h-3.5 w-3.5" />
          Send test
        </Button>
      </div>
    </div>
  )
}
