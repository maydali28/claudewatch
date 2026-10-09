import { useEffect, useState } from 'react'
import { LIVE_REFRESH_INTERVAL_MS } from '@shared/constants/tuning'

/**
 * The current time, re-read every `LIVE_REFRESH_INTERVAL_MS` while `enabled`,
 * so a live indicator ages out without waiting for the next file change.
 */
export function useNow(enabled = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => setNow(Date.now()), LIVE_REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [enabled])
  return now
}
