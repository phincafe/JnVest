import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Trash2, X, Wifi, WifiOff } from "lucide-react";
import { api, ApiError } from "../api/client";
import type { WatchlistQuotesResponse, WatchlistRow } from "../api/types";
import { useLiveQuotes, type StreamStatus } from "../hooks/useLiveQuotes";
import { changeClass, fmtPct, fmtPrice } from "../lib/format";
import { RangeBar } from "./RangeBar";
import { Skeleton } from "./Skeleton";

function streamLabel(status: StreamStatus): string {
  switch (status) {
    case "live":
      return "Live";
    case "connecting":
      return "Connecting…";
    case "reconnecting":
      return "Reconnecting…";
    case "no_credentials":
      return "Polling (no Alpaca keys)";
    default:
      return "Polling";
  }
}

const REFRESH_MS = 60_000;

type Props = {
  refreshNonce: number;
  selected: string | null;
  onSelect: (symbol: string) => void;
};

function smaDelta(price: number, ref: number | null): string {
  if (ref == null) return "—";
  const d = ((price - ref) / ref) * 100;
  return `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`;
}

function smaDeltaClass(price: number, ref: number | null): string {
  if (ref == null) return "text-(--color-text-dim)";
  return price >= ref ? "text-(--color-up)" : "text-(--color-down)";
}

function relVolBadge(r: number | null): string {
  if (r == null) return "—";
  return `${r.toFixed(2)}x`;
}

function rsiBadge(r: number | null): { text: string; cls: string } {
  if (r == null) return { text: "—", cls: "text-(--color-text-dim)" };
  let cls = "text-(--color-text-dim)";
  if (r >= 70) cls = "text-(--color-down)";
  else if (r <= 30) cls = "text-(--color-up)";
  return { text: r.toFixed(0), cls };
}

function earningsBadge(days: number | null): ReactNode {
  if (days == null || days < 0 || days > 14) return null;
  return (
    <span className="ml-2 rounded bg-purple-500/30 px-1.5 py-0.5 text-[10px] font-medium text-purple-200">
      ER {days}d
    </span>
  );
}

export function Watchlist({ refreshNonce, selected, onSelect }: Props) {
  const [rows, setRows] = useState<WatchlistRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const { quotes: live, status: streamStatus } = useLiveQuotes();

  const load = useCallback(async () => {
    try {
      const r = await api.get<WatchlistQuotesResponse>("/watchlist/quotes");
      setRows(r.rows);
      setErr(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e.detail : (e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load, refreshNonce]);

  const onAdd = async (e: FormEvent) => {
    e.preventDefault();
    const sym = adding.trim().toUpperCase();
    if (!sym) return;
    setBusy(true);
    try {
      await api.post("/watchlist", { symbol: sym });
      setAdding("");
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.detail : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (sym: string) => {
    setBusy(true);
    try {
      await api.delete(`/watchlist/${sym}`);
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.detail : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-(--color-text-dim)">Watchlist</h2>
          <span
            className="flex items-center gap-1 text-xs text-(--color-text-dim)"
            title={streamLabel(streamStatus)}
          >
            {streamStatus === "live" ? (
              <Wifi size={12} className="text-(--color-up)" />
            ) : (
              <WifiOff size={12} />
            )}
            {streamLabel(streamStatus)}
          </span>
        </div>
        <form onSubmit={onAdd} className="flex items-center gap-2">
          <input
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            placeholder="Add ticker (e.g. NFLX)"
            className="w-44 rounded-md border border-(--color-border) bg-(--color-panel) px-2 py-1 text-xs uppercase placeholder:text-(--color-text-dim)/60 focus:border-(--color-accent) focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || !adding.trim()}
            className="rounded-md border border-(--color-border) px-2 py-1 text-xs hover:bg-(--color-panel) disabled:opacity-50"
          >
            Add
          </button>
        </form>
      </div>

      {err && (
        <div className="rounded-md border border-(--color-down)/40 bg-(--color-panel) p-2 text-xs text-(--color-down)">
          {err}
          <button
            onClick={() => setErr(null)}
            className="ml-2 inline-flex items-center text-(--color-text-dim) hover:text-(--color-text)"
            aria-label="Dismiss"
          >
            <X size={12} />
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-(--color-border) bg-(--color-panel)">
        <table className="min-w-full text-sm">
          <thead className="bg-(--color-panel-2) text-xs uppercase text-(--color-text-dim)">
            <tr>
              <th className="px-3 py-2 text-left">Symbol</th>
              <th className="px-3 py-2 text-right">Last</th>
              <th className="px-3 py-2 text-right">Change</th>
              <th className="px-3 py-2 text-right">Rel Vol</th>
              <th className="px-3 py-2 text-right">vs 20D</th>
              <th className="px-3 py-2 text-right">vs 50D</th>
              <th className="px-3 py-2 text-right">vs 200D</th>
              <th className="px-3 py-2 text-right">RSI</th>
              <th className="px-3 py-2 text-left">52W</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows === null
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={10} className="px-3 py-2">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  </tr>
                ))
              : rows.length === 0
                ? (
                    <tr>
                      <td
                        colSpan={10}
                        className="px-3 py-6 text-center text-sm text-(--color-text-dim)"
                      >
                        Watchlist is empty. Add a ticker above.
                      </td>
                    </tr>
                  )
                : rows.map((r) => {
                    const rsiB = rsiBadge(r.rsi14);
                    const isSel = selected === r.symbol;
                    const liveQ = live.get(r.symbol);
                    const lastPrice = liveQ?.price ?? r.last;
                    const livePct =
                      r.prev_close > 0
                        ? ((lastPrice - r.prev_close) / r.prev_close) * 100
                        : r.change_pct;
                    return (
                      <tr
                        key={r.symbol}
                        onClick={() => onSelect(r.symbol)}
                        className={`cursor-pointer border-t border-(--color-border) hover:bg-(--color-panel-2) ${
                          isSel ? "bg-(--color-panel-2)" : ""
                        }`}
                      >
                        <td className="px-3 py-2 font-medium">
                          {r.symbol}
                          {earningsBadge(r.earnings_in_days)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmtPrice(lastPrice)}
                          {liveQ && (
                            <span
                              className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-(--color-up)"
                              aria-label="Live"
                            />
                          )}
                        </td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums ${changeClass(livePct)}`}
                        >
                          {fmtPct(livePct)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {relVolBadge(r.rel_volume)}
                        </td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums ${smaDeltaClass(r.last, r.sma20)}`}
                        >
                          {smaDelta(r.last, r.sma20)}
                        </td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums ${smaDeltaClass(r.last, r.sma50)}`}
                        >
                          {smaDelta(r.last, r.sma50)}
                        </td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums ${smaDeltaClass(r.last, r.sma200)}`}
                        >
                          {smaDelta(r.last, r.sma200)}
                        </td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums ${rsiB.cls}`}
                        >
                          {rsiB.text}
                        </td>
                        <td className="px-3 py-2">
                          {r.high_52w != null && r.low_52w != null ? (
                            <RangeBar
                              low={r.low_52w}
                              high={r.high_52w}
                              value={r.last}
                            />
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemove(r.symbol);
                            }}
                            disabled={busy}
                            className="text-(--color-text-dim) hover:text-(--color-down)"
                            aria-label={`Remove ${r.symbol}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
