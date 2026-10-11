import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

export type ToastVariant = 'error' | 'warning' | 'info' | 'success'

/** A button on the toast; clicking it also dismisses the toast. */
export interface ToastAction {
  label: string
  onClick: () => void
}

interface Toast {
  id: number
  message: string
  variant: ToastVariant
  ttlMs: number
  action?: ToastAction
}

interface ToastContextValue {
  push: (message: string, variant?: ToastVariant, ttlMs?: number, action?: ToastAction) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let nextId = 1

// The colour is the border and its thick left edge only. The text and the
// solid background come from the theme's popover tokens, so a toast reads in
// light and dark alike (a tinted background with light text vanished in light).
// `!` because the unlayered `* { border-color }` reset outranks border colours (L23).
const VARIANT_STYLES: Record<ToastVariant, string> = {
  error: '!border-red-500/50 !border-l-red-500',
  warning: '!border-amber-500/50 !border-l-amber-500',
  info: '!border-sky-500/50 !border-l-sky-500',
  success: '!border-emerald-500/50 !border-l-emerald-500',
}

export function ToastProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const push = useCallback<ToastContextValue['push']>(
    (message, variant = 'info', ttlMs = 5000, action) => {
      const id = nextId++
      setToasts((prev) => [...prev, { id, message, variant, ttlMs, action }])
    },
    []
  )

  const value = useMemo(() => ({ push }), [push])

  // Expose globally so non-React modules (e.g. ipc helpers) can push toasts
  useEffect(() => {
    ;(window as unknown as { __toast?: ToastContextValue['push'] }).__toast = push
    return () => {
      delete (window as unknown as { __toast?: ToastContextValue['push'] }).__toast
    }
  }, [push])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="region"
        aria-label="Notifications"
        className="pointer-events-none fixed bottom-4 right-4 z-[9999] flex flex-col gap-2"
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast
  onDismiss: (id: number) => void
}): React.JSX.Element {
  useEffect(() => {
    if (toast.ttlMs <= 0) return
    const timer = setTimeout(() => onDismiss(toast.id), toast.ttlMs)
    return () => clearTimeout(timer)
  }, [toast.id, toast.ttlMs, onDismiss])

  return (
    <div
      role="status"
      className={`pointer-events-auto flex max-w-sm items-start gap-3 rounded-md border border-l-4 bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg ${VARIANT_STYLES[toast.variant]}`}
    >
      <span className="flex-1">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick()
            onDismiss(toast.id)
          }}
          className="shrink-0 text-xs font-semibold underline underline-offset-2 hover:opacity-80"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="text-xs opacity-60 hover:opacity-100"
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}

/**
 * Push a toast from non-React code. Safe to call at any time — it's a no-op
 * if the provider hasn't mounted yet.
 */
export function toast(
  message: string,
  variant: ToastVariant = 'info',
  ttlMs = 5000,
  action?: ToastAction
): void {
  const fn = (window as unknown as { __toast?: ToastContextValue['push'] }).__toast
  fn?.(message, variant, ttlMs, action)
}
