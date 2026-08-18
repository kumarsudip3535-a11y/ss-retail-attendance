import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Catches render errors that would otherwise silently unmount the whole
 * app (React's default behavior with no boundary in place), and displays
 * them on screen instead. This is a diagnostic/safety net — the goal is
 * for the person using the app to always see something actionable rather
 * than a blank page.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Caught render error:', error, errorInfo)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white border border-red-200 shadow-sm p-6">
            <h1 className="text-lg font-semibold text-red-700">
              Something went wrong
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              {this.state.error.message}
            </p>
            <pre className="mt-4 text-xs text-slate-400 whitespace-pre-wrap max-h-64 overflow-auto bg-slate-50 rounded-lg p-3">
              {this.state.error.stack}
            </pre>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 text-sm text-brand-600 hover:text-brand-700 font-medium"
            >
              Reload page
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
