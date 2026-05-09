import { TrendingDown, TrendingUp } from "lucide-react";
import { api } from "../api/client";
import type { WsbItem, WsbResponse } from "../api/types";
import { useCachedFetch } from "../hooks/useCachedFetch";
import { Skeleton } from "./Skeleton";

type Props = {
  refreshNonce: number;
  /** Click on a row → open the ticker (in the watchlist tab StockDetail). */
  onSelect?: (symbol: string) => void;
};

/** Top tickers chattered about on r/wallstreetbets, with rank delta + sentiment.
 * Sourced from ApeWisdom (free, no auth, scraped from Reddit). Cached 15min. */
export function WsbPulse({ refreshNonce, onSelect }: Props) {
  const { data, isFetching, refetch } = useCachedFetch<WsbResponse>(
    "market:wsb",
    () => api.get("/market/wsb?limit=10"),
    { refreshMs: 15 * 60_000, staleAfterMs: 5 * 60_000 },
  );
  void refreshNonce;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-(--color-text-dim)">
          WSB Pulse{" "}
          <span className="text-[10px] uppercase tracking-wide text-(--color-text-dim)/70">
            r/wallstreetbets · last 24h
          </span>
        </h2>
        <button
          onClick={refetch}
          disabled={isFetching}
          className="text-xs text-(--color-text-dim) hover:text-(--color-text) disabled:opacity-50"
        >
          refresh
        </button>
      </div>
      {!data ? (
        <Skeleton className="h-48" />
      ) : data.warning ? (
        <p className="text-xs text-(--color-text-dim)">{data.warning}</p>
      ) : data.items.length === 0 ? (
        <p className="text-xs text-(--color-text-dim)">No data right now.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-(--color-border) bg-(--color-panel)">
          <table className="w-full text-sm">
            <thead className="text-xs text-(--color-text-dim)">
              <tr className="border-b border-(--color-border)">
                <th className="px-3 py-2 text-left font-normal">#</th>
                <th className="px-3 py-2 text-left font-normal">Ticker</th>
                <th className="px-3 py-2 text-right font-normal">Mentions</th>
                <th
                  className="px-3 py-2 text-right font-normal"
                  title="Change in mentions vs 24h ago"
                >
                  Δ 24h
                </th>
                <th
                  className="px-3 py-2 text-right font-normal"
                  title="Bullish-bearish sentiment, 0–100. ≥60 bullish, ≤40 bearish."
                >
                  Sentiment
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((it) => (
                <Row key={it.symbol} item={it} onSelect={onSelect} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Row({ item, onSelect }: { item: WsbItem; onSelect?: (s: string) => void }) {
  const delta =
    item.mentions != null && item.mentions_24h_ago != null
      ? item.mentions - item.mentions_24h_ago
      : null;
  const deltaPct =
    delta != null && item.mentions_24h_ago && item.mentions_24h_ago > 0
      ? (delta / item.mentions_24h_ago) * 100
      : null;
  const sent = item.sentiment;
  const sentBadge =
    sent == null
      ? null
      : sent >= 60
        ? { label: "bullish", cls: "text-(--color-up)" }
        : sent <= 40
          ? { label: "bearish", cls: "text-(--color-down)" }
          : { label: "neutral", cls: "text-(--color-text-dim)" };

  const row = (
    <tr
      onClick={() => onSelect?.(item.symbol)}
      className={`border-t border-(--color-border) ${
        onSelect ? "cursor-pointer hover:bg-(--color-panel-2)" : ""
      }`}
    >
      <td className="px-3 py-2 text-(--color-text-dim) tabular-nums">{item.rank}</td>
      <td className="px-3 py-2 font-medium">{item.symbol}</td>
      <td className="px-3 py-2 text-right tabular-nums">{item.mentions ?? "—"}</td>
      <td
        className={`px-3 py-2 text-right tabular-nums ${
          delta == null
            ? "text-(--color-text-dim)"
            : delta > 0
              ? "text-(--color-up)"
              : delta < 0
                ? "text-(--color-down)"
                : "text-(--color-text-dim)"
        }`}
      >
        {delta == null ? (
          "—"
        ) : (
          <span className="inline-flex items-center justify-end gap-1">
            {delta > 0 ? (
              <TrendingUp size={11} />
            ) : delta < 0 ? (
              <TrendingDown size={11} />
            ) : null}
            {delta > 0 ? "+" : ""}
            {delta}
            {deltaPct != null && Math.abs(deltaPct) >= 1 && (
              <span className="text-[10px] text-(--color-text-dim)">
                {" "}
                ({deltaPct > 0 ? "+" : ""}
                {deltaPct.toFixed(0)}%)
              </span>
            )}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {sentBadge ? (
          <span className={sentBadge.cls}>
            {sent!.toFixed(0)}
            <span className="ml-1 text-[10px] uppercase tracking-wide">
              {sentBadge.label}
            </span>
          </span>
        ) : (
          <span className="text-(--color-text-dim)">—</span>
        )}
      </td>
    </tr>
  );
  return row;
}
