import type { NotificationStatus } from '@shared/types/notifications'

// Every system notification ClaudeWatch sends goes through here, so the app
// can tell whether the OS lets them through. Electron cannot ask macOS (or
// Windows) whether notifications are allowed; it only reports, per
// notification, that it showed or that showing it failed. The last answer
// wins: "blocked" after a failure, "allowed" after a notification shows.

/** The part of Electron's `Notification` used here, so tests can fake it. */
export interface NotificationLike {
  on(event: string, listener: (...args: unknown[]) => void): unknown
  show(): void
}

export interface NotifierDeps {
  isSupported: () => boolean
  create: (options: { title: string; body: string }) => NotificationLike
  onStatusChange: (status: NotificationStatus) => void
}

export class Notifier {
  private current: NotificationStatus

  constructor(private readonly deps: NotifierDeps) {
    this.current = deps.isSupported() ? 'unknown' : 'unsupported'
  }

  get status(): NotificationStatus {
    return this.current
  }

  /** False when the OS has no notifications; nothing is shown then. */
  show(note: { title: string; body: string; onClick?: () => void }): boolean {
    if (this.current === 'unsupported') return false
    const n = this.deps.create({ title: note.title, body: note.body })
    n.on('show', () => this.set('allowed'))
    n.on('failed', () => this.set('blocked'))
    if (note.onClick) n.on('click', note.onClick)
    n.show()
    return true
  }

  private set(status: NotificationStatus): void {
    if (status === this.current) return
    this.current = status
    this.deps.onStatusChange(status)
  }
}

// ─── Singleton for the app ────────────────────────────────────────────────────

let notifier: Notifier | null = null

export function initNotifier(deps: NotifierDeps): Notifier {
  notifier = new Notifier(deps)
  return notifier
}

export function getNotifier(): Notifier | null {
  return notifier
}
