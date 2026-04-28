import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

export type ToastVariant = 'error' | 'warning' | 'info' | 'success'

interface Toast {
  id: number
  message: string
  variant: ToastVariant
  ttlMs: number
}

interface ToastContextValue {
  push: (message: string, variant?: ToastVariant, ttlMs?: number) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let nextId = 1

const VARIANT_STYLES: Record<ToastVariant, string> = {
  error: 'border-red-500/40 bg-red-500/10 text-red-100',
  warning: 'border-amber-500/40 bg-amber-500/10 text-amber-100',
  info: 'border-sky-500/40 bg-sky-500/10 text-sky-100',
  success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100',
}

export function ToastProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const push = useCallback<ToastContextValue['push']>((message, variant = 'info', ttlMs = 5000) => {
    const id = nextId++
    setToasts((prev) => [...prev, { id, message, variant, ttlMs }])
  }, [])

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
      className={`pointer-events-auto flex max-w-sm items-start gap-3 rounded-md border px-3 py-2 text-sm shadow-lg backdrop-blur ${VARIANT_STYLES[toast.variant]}`}
    >
      <span className="flex-1">{toast.message}</span>
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
export function toast(message: string, variant: ToastVariant = 'info', ttlMs = 5000): void {
  const fn = (window as unknown as { __toast?: ToastContextValue['push'] }).__toast
  fn?.(message, variant, ttlMs)
}
