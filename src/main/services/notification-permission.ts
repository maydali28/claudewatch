import * as path from 'path'
import type { NotificationStatus } from '@shared/types/notifications'

// macOS only: ask System Settings whether ClaudeWatch may show notifications,
// through the native addon in native/notification-status (built into
// out/native by scripts/build-native.mjs). Elsewhere, or without the addon,
// the answer is null and the app falls back to what notifications reported.

interface NotificationStatusAddon {
  status: () => Promise<string>
}

/** Where the addon sits for a main bundle in `mainDir`; a .node cannot load from inside app.asar. */
export function addonPath(mainDir: string): string {
  return path
    .join(mainDir, '..', 'native', 'notification-status.node')
    .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
}

export function toNotificationStatus(answer: string): NotificationStatus | null {
  switch (answer) {
    case 'authorized':
    case 'provisional':
      return 'allowed'
    case 'denied':
      return 'blocked'
    case 'notDetermined':
      return 'unknown'
    default:
      return null
  }
}

let cached: NotificationStatusAddon | null | undefined

function loadAddon(): NotificationStatusAddon | null {
  if (cached !== undefined) return cached
  try {
    const mod = { exports: {} as NotificationStatusAddon }
    process.dlopen(mod, addonPath(__dirname))
    cached = mod.exports
  } catch {
    cached = null
  }
  return cached
}

export async function readOsNotificationStatus(
  deps: { platform: NodeJS.Platform; load: () => NotificationStatusAddon | null } = {
    platform: process.platform,
    load: loadAddon,
  }
): Promise<NotificationStatus | null> {
  if (deps.platform !== 'darwin') return null
  const addon = deps.load()
  if (!addon) return null
  try {
    return toNotificationStatus(await addon.status())
  } catch {
    return null
  }
}
