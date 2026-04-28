import React from 'react'
import { ipc } from '@renderer/lib/ipc-client'

interface Props {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Uncaught render error:', error, info.componentStack)
    ipc.sentry.captureException(error.message, error.stack, 'ErrorBoundary').catch(() => {
      /* best-effort */
    })
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Something went wrong</p>
            <p className="text-xs max-w-sm">{this.state.error.message}</p>
            <button
              className="text-xs underline hover:text-foreground"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
          </div>
        )
      )
    }
    return this.props.children
  }
}
