import React, { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/components/ui/dialog'
import { useSettingsStore } from '@renderer/store/settings.store'
import { ipc } from '@renderer/lib/ipc-client'
import { getChangelogForVersion, getLatestChangelog } from '@renderer/lib/changelog'
import MarkdownRenderer from './markdown-renderer'

/**
 * Shows a one-shot release-notes modal the first time the user opens a build
 * whose version differs from `prefs.lastSeenVersion`. The persisted pointer
 * advances as soon as the modal mounts, so dismissing or quitting still
 * suppresses the modal on next launch — by design, since the alternative
 * (only mark on dismiss) keeps re-prompting for users who close it via Esc.
 */
export function WhatsNewModal(): React.JSX.Element | null {
  const { prefs, isLoaded, updatePref } = useSettingsStore()
  const [open, setOpen] = useState(false)
  const [currentVersion, setCurrentVersion] = useState<string | null>(null)

  useEffect(() => {
    if (!isLoaded) return
    let cancelled = false
    ipc.app
      .getVersion()
      .then((result) => {
        if (cancelled || !result.ok) return
        const version = result.data
        setCurrentVersion(version)
        if (prefs.lastSeenVersion === version) return
        // First-run case (no prior version): silently mark as seen, no modal.
        // We only celebrate *upgrades*, not the very first launch.
        if (!prefs.lastSeenVersion) {
          updatePref('lastSeenVersion', version)
          return
        }
        const entry = getChangelogForVersion(version) ?? getLatestChangelog()
        if (!entry) {
          updatePref('lastSeenVersion', version)
          return
        }
        setOpen(true)
        updatePref('lastSeenVersion', version)
      })
      .catch(() => {
        /* non-critical */
      })
    return (): void => {
      cancelled = true
    }
  }, [isLoaded, prefs.lastSeenVersion, updatePref])

  if (!currentVersion) return null
  const entry = getChangelogForVersion(currentVersion) ?? getLatestChangelog()
  if (!entry) return null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <DialogTitle>What&apos;s new in {entry.version}</DialogTitle>
          </div>
        </DialogHeader>
        <MarkdownRenderer content={entry.body} className="mt-4 text-muted-foreground" />
        <div className="mt-6 flex justify-end">
          <button
            onClick={() => setOpen(false)}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
          >
            Got it
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
