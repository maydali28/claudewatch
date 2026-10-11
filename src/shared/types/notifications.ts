/**
 * Whether the OS shows ClaudeWatch's system notifications. Learned from the
 * last one sent: there is no way to ask beforehand, so it starts `unknown`.
 */
export type NotificationStatus = 'unknown' | 'allowed' | 'blocked' | 'unsupported'
