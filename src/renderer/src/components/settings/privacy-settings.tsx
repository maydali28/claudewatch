import React, { useState } from 'react'
import { Bug, MessageSquare, CheckCircle, AlertCircle, Loader2, RotateCcw } from 'lucide-react'
import { Switch } from '@renderer/components/ui/switch'
import { Label } from '@renderer/components/ui/label'
import { Button } from '@renderer/components/ui/button'
import { useSettingsStore } from '@renderer/store/settings.store'
import { ipc } from '@renderer/lib/ipc-client'

type FeedbackState = 'idle' | 'sending' | 'sent' | 'error'

export default function PrivacySettings(): React.JSX.Element {
  const { prefs, updatePref } = useSettingsStore()
  const [pendingRestart, setPendingRestart] = useState(false)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [feedbackState, setFeedbackState] = useState<FeedbackState>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSubmitFeedback(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!message.trim()) return
    setFeedbackState('sending')
    try {
      const result = await ipc.feedback.submit(name.trim(), email.trim(), message.trim())
      if (result.ok) {
        setFeedbackState('sent')
        setName('')
        setEmail('')
        setMessage('')
      } else {
        setErrorMsg(result.error)
        setFeedbackState('error')
      }
    } catch (err) {
      setErrorMsg(String(err))
      setFeedbackState('error')
    }
  }

  return (
    <div className="space-y-6">
      {/* Crash reports toggle */}
      <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
        <div className="flex gap-3">
          <Bug className="h-5 w-5 mt-0.5 text-primary shrink-0" />
          <div>
            <Label htmlFor="sentry-toggle" className="text-sm font-medium cursor-pointer">
              Crash reports
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Send anonymous crash reports to help fix bugs. No session content, file paths, or
              personal data is ever included.
            </p>
          </div>
        </div>
        <Switch
          id="sentry-toggle"
          checked={prefs.sentryEnabled}
          onCheckedChange={(v) => {
            updatePref('sentryEnabled', v)
            setPendingRestart(true)
          }}
        />
      </div>

      {pendingRestart && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950">
          <p className="text-xs text-amber-800 dark:text-amber-200">
            Restart required for crash report changes to take effect.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => ipc.app.relaunch()}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Restart now
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Crash reports are processed by Sentry and contain only stack traces and error messages.
        ClaudeWatch never sends session data, API keys, or file contents.
      </p>

      {/* User feedback form */}
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Send feedback</h3>
        </div>

        {!prefs.sentryEnabled ? (
          <p className="text-xs text-muted-foreground">
            Enable crash reports above to send feedback.
          </p>
        ) : feedbackState === 'sent' ? (
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
            <CheckCircle className="h-4 w-4" />
            Feedback sent — thank you!
          </div>
        ) : (
          <form onSubmit={handleSubmitFeedback} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="feedback-name" className="text-xs text-muted-foreground">
                  Name (optional)
                </Label>
                <input
                  id="feedback-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  maxLength={100}
                  className="w-full rounded-md border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="feedback-email" className="text-xs text-muted-foreground">
                  Email (optional)
                </Label>
                <input
                  id="feedback-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  maxLength={254}
                  className="w-full rounded-md border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="feedback-message" className="text-xs text-muted-foreground">
                Message
              </Label>
              <textarea
                id="feedback-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Describe a bug, suggest a feature, or share any thoughts…"
                maxLength={2000}
                rows={4}
                required
                className="w-full rounded-md border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
              <p className="text-right text-xs text-muted-foreground">{message.length}/2000</p>
            </div>

            {feedbackState === 'error' && (
              <div className="flex items-center gap-2 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {errorMsg}
              </div>
            )}

            <Button
              type="submit"
              size="sm"
              disabled={!message.trim() || feedbackState === 'sending'}
            >
              {feedbackState === 'sending' ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Sending…
                </>
              ) : (
                'Send feedback'
              )}
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
