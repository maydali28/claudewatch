/**
 * Whether the "restart to start sending crash reports" banner should be
 * shown in the privacy settings toggle.
 *
 * The Sentry SDK can only be initialised before Electron's 'ready' event
 * fires (`@sentry/electron`'s IPC transport registers a custom protocol
 * scheme that throws once the app is ready). Enabling crash reports from a
 * cold "off" start therefore always requires a restart when the toggle is
 * flipped while the app is already running — turning it off, by contrast,
 * always applies immediately (it only flips the SDK's own enabled flag).
 *
 * So the banner is shown exactly when the toggle transitions from off to on
 * in this session, and hidden again the moment the user turns it back off.
 */
export function shouldShowRestartBanner(previousValue: boolean, nextValue: boolean): boolean {
  return !previousValue && nextValue
}
