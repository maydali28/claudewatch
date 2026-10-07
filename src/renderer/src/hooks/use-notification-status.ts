import { useEffect, useState } from 'react'
import { CHANNELS } from '@shared/ipc/channels'
import { ipc } from '@renderer/lib/ipc-client'
import type { NotificationStatus } from '@shared/types'

/** Whether the OS shows ClaudeWatch's notifications, as main last learned it. */
export function useNotificationStatus(): NotificationStatus {
  const [status, setStatus] = useState<NotificationStatus>('unknown')
  useEffect(() => {
    let live = true
    void ipc.notifications.status().then((r) => {
      if (live && r.ok) setStatus(r.data)
    })
    const unsub = ipc.on<NotificationStatus>(CHANNELS.PUSH_NOTIFICATION_STATUS, setStatus)
    return () => {
      live = false
      unsub()
    }
  }, [])
  return status
}
