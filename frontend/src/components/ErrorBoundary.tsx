import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode; fallback?: ReactNode };
type State = { error: Error | null };

/**
 * Catches errors thrown during render or in lifecycle methods of any child.
 * Without this, a chart cleanup failure (lightweight-charts unmount race,
 * Recharts ResponsiveContainer measurement on a torn-down node, etc.) escapes
 * React's render and the whole document goes blank until reload.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div className="mx-auto max-w-md p-6 text-sm">
            <div className="rounded-xl border border-(--color-down)/40 bg-(--color-panel) p-4">
              <h3 className="mb-2 font-semibold text-(--color-down)">
                Something broke rendering this view
              </h3>
              <p className="mb-3 text-xs text-(--color-text-dim)">
                {this.state.error.message}
              </p>
              <button
                onClick={this.reset}
                className="rounded-md border border-(--color-border) px-3 py-1.5 text-xs hover:bg-(--color-panel-2)"
              >
                Try again
              </button>
            </div>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
