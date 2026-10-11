import React, { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { useSettingsStore } from '@renderer/store/settings.store'

/** How often to check whether another dialog (What's New) is still open. */
const WAIT_MS = 1000

/**
 * Asks once whether to scan transcripts for leaked secrets. Shown while
 * `secretScanConsent` is `unasked`, after any other dialog (What's New) has
 * closed so the two never stack. Either answer is recorded, so it does not
 * come back; Settings › Security changes it later.
 */
export function SecretScanConsentPrompt(): React.JSX.Element | null {
  const { prefs, isLoaded, updatePrefs } = useSettingsStore()
  const unasked = isLoaded && prefs.secretScanConsent === 'unasked'
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!unasked || open) return
    const id = setInterval(() => {
      if (!document.querySelector('[role="dialog"]')) {
        setOpen(true)
        clearInterval(id)
      }
    }, WAIT_MS)
    return () => clearInterval(id)
  }, [unasked, open])

  if (!unasked) return null

  const answer = (granted: boolean): void => {
    setOpen(false)
    void updatePrefs({
      secretScanConsent: granted ? 'granted' : 'declined',
      secretScanEnabled: granted,
    })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && answer(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Scan transcripts for leaked secrets?
          </DialogTitle>
          <DialogDescription>
            ClaudeWatch can warn you when an API key, token or password lands in a session.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          <li>• Runs on this machine; nothing is sent anywhere.</li>
          <li>• Checks what Claude Code writes from now on, including sub-agents.</li>
          <li>• Keeps only masked values (sk-a****9f3c), never the secret itself.</li>
          <li>• You can scan older sessions or turn it off in Settings › Security.</li>
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => answer(false)}>
            Not now
          </Button>
          <Button onClick={() => answer(true)}>Turn on scanning</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
