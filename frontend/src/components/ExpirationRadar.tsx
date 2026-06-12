/** Expiration radar — owned option contracts grouped by days-to-expiry.
 * The classic mistake this prevents: forgetting short-dated contracts and
 * watching them decay (or exercise) over a weekend. Contracts inside 7 days
 * get the loud treatment.
 *
 * Reads the shared snaptrade:holdings cache — no extra fetch. Works for
 * guests too (their rows carry contract identity but no qty/$). */
import { useMemo } from "react";
import { AlarmClock } from "lucide-react";
import { api } from "../api/client";
import type { SnapTradeHoldings, SnapTradeOption } from "../api/types";
import { useCachedFetch } from "../hooks/useCachedFetch";
import { fmtPrice } from "../lib/format";

const REFRESH_MS = 5 * 60_000;

type RadarRow = {
  option: SnapTradeOption;
  dte: number;
};

function daysToExpiry(expiration: string | null): number | null {
  if (!expiration) return null;
  const exp = new Date(expiration + "T16:00:00");
  if (isNaN(exp.getTime())) return null;
  return Math.ceil((exp.getTime() - Date.now()) / 86_400_000);
}

function contractLabel(o: SnapTradeOption): string {
  const t = (o.option_type ?? "").toLowerCase().startsWith("c") ? "C" : "P";
  return `${o.underlying ?? "—"} $${o.strike ?? "?"}${t}`;
}

const BUCKETS = [
  { key: "urgent", label: "≤ 7 days", max: 7 },
  { key: "soon", label: "8–30 days", max: 30 },
  { key: "later", label: "31+ days", max: Infinity },
] as const;

export function ExpirationRadar({
  refreshNonce,
  isGuest,
}: {
  refreshNonce: number;
  isGuest: boolean;
}) {
  const { data } = useCachedFetch<SnapTradeHoldings>(
    "snaptrade:holdings",
    () => api.get("/snaptrade/holdings"),
    { refreshMs: REFRESH_MS, staleAfterMs: 60_000 },
  );
  void refreshNonce;

  const buckets = useMemo(() => {
    const opts = data?.options ?? [];
    const rows: RadarRow[] = [];
    for (const o of opts) {
      const dte = daysToExpiry(o.expiration);
      if (dte == null || dte < 0) continue;
      rows.push({ option: o, dte });
    }
    rows.sort((a, b) => a.dte - b.dte);
    return BUCKETS.map((b, i) => ({
      ...b,
      rows: rows.filter(
        (r) => r.dte <= b.max && (i === 0 || r.dte > BUCKETS[i - 1].max),
      ),
    }));
  }, [data]);

  const total = buckets.reduce((s, b) => s + b.rows.length, 0);
  // No options held → no radar. Don't render an empty box.
  if (!data || total === 0) return null;

  const urgentCount = buckets[0].rows.length;

  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 text-sm font-medium text-(--color-text-dim)">
        <AlarmClock size={14} className={urgentCount ? "text-(--color-down)" : "text-(--color-accent)"} />
        Expiration radar
        {urgentCount > 0 && (
          <span className="rounded bg-(--color-down)/20 px-1.5 py-0.5 text-[10px] font-semibold text-(--color-down)">
            {urgentCount} expiring ≤7d
          </span>
        )}
      </h2>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {buckets.map((b) => (
          <div
            key={b.key}
            className={`rounded-xl border bg-(--color-panel) p-3 ${
              b.key === "urgent" && b.rows.length > 0
                ? "border-(--color-down)/50"
                : "border-(--color-border)"
            }`}
          >
            <h3 className="mb-2 text-[10px] uppercase tracking-wide text-(--color-text-dim)">
              {b.label}{" "}
              <span className="tabular-nums">({b.rows.length})</span>
            </h3>
            {b.rows.length === 0 ? (
              <p className="text-xs text-(--color-text-dim)/70">None</p>
            ) : (
              <ul className="space-y-1.5">
                {b.rows.map((r, i) => (
                  <li
                    key={i}
                    className="flex items-baseline justify-between gap-2 text-xs"
                  >
                    <span className="min-w-0 truncate font-medium">
                      {contractLabel(r.option)}
                      <span className="ml-1.5 text-[10px] text-(--color-text-dim)">
                        {r.option.expiration}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
                      {!isGuest && r.option.market_value != null && (
                        <span className="text-[11px] text-(--color-text-dim)">
                          ${fmtPrice(r.option.market_value, 0)}
                        </span>
                      )}
                      <span
                        className={`text-[11px] font-semibold ${
                          r.dte <= 2
                            ? "text-(--color-down)"
                            : r.dte <= 7
                              ? "text-yellow-300"
                              : "text-(--color-text-dim)"
                        }`}
                      >
                        {r.dte}d
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
