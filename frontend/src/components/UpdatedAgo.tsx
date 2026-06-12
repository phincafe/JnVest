import { useEffect, useState } from "react";

function label(fetchedAt: number): string {
  const s = Math.max(0, Math.floor((Date.now() - fetchedAt) / 1000));
  if (s < 5) return "updated just now";
  if (s < 60) return `updated ${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `updated ${m}m ago`;
  const h = Math.floor(m / 60);
  return `updated ${h}h ago`;
}

/** Small "updated Xs ago" stamp driven by useCachedFetch's fetchedAt.
 * Re-renders on a 15s timer so the label stays roughly current without
 * forcing parent re-renders. */
export function UpdatedAgo({
  fetchedAt,
  className = "",
}: {
  fetchedAt: number | null;
  className?: string;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 15_000);
    return () => window.clearInterval(id);
  }, []);
  if (fetchedAt == null) return null;
  return (
    <span
      className={`text-[10px] tabular-nums text-(--color-text-dim)/70 ${className}`}
      title={new Date(fetchedAt).toLocaleTimeString()}
    >
      {label(fetchedAt)}
    </span>
  );
}
