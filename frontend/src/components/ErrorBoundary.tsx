import { Component, type ErrorInfo, type ReactNode } from "react";
import { isChunkLoadError, reloadOnce } from "../lib/lazyWithReload";

type Props = { children: ReactNode; fallback?: ReactNode };
type State = { error: Error | null };

/**
 * Catches errors thrown during render or in lifecycle methods of any child.
 * Without this, a chart cleanup failure (lightweight-charts unmount race,
 * Recharts ResponsiveContainer measurement on a torn-down node, etc.) escapes
 * React's render and the whole document goes blank until reload.
 *
 * Special-cases chunk-load errors (post-deploy stale-hash 404s) by hard
 * reloading once instead of showing the error UI — same logic that
 * lazyWithReload uses, here as the second line of defense in case the
 * error escaped during preload or some non-lazy code path.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (isChunkLoadError(error)) {
      // Try a hard reload (guarded so we don't loop). If reload was
      // throttled, fall through to the error UI with a hint.
      reloadOnce();
      return;
    }
    // eslint-disable-next-line no-console
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      const isChunk = isChunkLoadError(this.state.error);
      return (
        this.props.fallback ?? (
          <div className="mx-auto max-w-md p-6 text-sm">
            <div className="rounded-xl border border-(--color-down)/40 bg-(--color-panel) p-4">
              <h3 className="mb-2 font-semibold text-(--color-down)">
                {isChunk ? "App was updated — please reload" : "Something broke rendering this view"}
              </h3>
              <p className="mb-3 text-xs text-(--color-text-dim)">
                {isChunk
                  ? "The app was redeployed while this tab was open. A reload will fix it."
                  : this.state.error.message}
              </p>
              <button
                onClick={isChunk ? () => window.location.reload() : this.reset}
                className="rounded-md border border-(--color-border) px-3 py-1.5 text-xs hover:bg-(--color-panel-2)"
              >
                {isChunk ? "Reload now" : "Try again"}
              </button>
            </div>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
