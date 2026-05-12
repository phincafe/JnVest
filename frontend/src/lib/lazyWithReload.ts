import { lazy, type ComponentType } from "react";

/** Heuristic: errors thrown when a dynamically imported chunk 404s after a
 * deploy. Different browsers / environments phrase it slightly differently. */
export function isChunkLoadError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err ?? "");
  return (
    msg.includes("Failed to fetch dynamically imported module") ||
    msg.includes("Importing a module script failed") ||
    msg.includes("error loading dynamically imported module") ||
    msg.includes("Loading chunk") || // Webpack-style
    msg.includes("Loading CSS chunk")
  );
}

/** Once-per-session reload guard so we don't infinite-loop if reload also
 * fails. Window: 30s — long enough to dedupe a single bad-deploy moment,
 * short enough that a stale tab returning hours later still gets a reload. */
const RELOAD_KEY = "jnvest:chunk_reload_at";
const RELOAD_GUARD_MS = 30_000;

export function reloadOnce(): boolean {
  try {
    const last = parseInt(sessionStorage.getItem(RELOAD_KEY) ?? "0", 10);
    if (Date.now() - last < RELOAD_GUARD_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}

/** Wraps React.lazy with a hard reload when the chunk fails to load — the
 * classic "old index chunk references an asset hash that no longer exists
 * after a fresh deploy" problem. The reload pulls fresh entry + chunk
 * hashes and the navigation succeeds.
 *
 * Guarded so a genuinely broken chunk doesn't reload-loop the user. */
export function lazyWithReload<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (err) {
      if (isChunkLoadError(err) && reloadOnce()) {
        // We're reloading — return a noop component so React doesn't
        // throw before the navigation completes.
        return { default: (() => null) as unknown as T };
      }
      throw err;
    }
  });
}
