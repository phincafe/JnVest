import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { ArrowDown, ArrowUp, Trash2, Wifi, WifiOff, X } from "lucide-react";
import { api, ApiError } from "../api/client";
import type { WatchlistQuotesResponse } from "../api/types";
import { clearCacheKey, useCachedFetch } from "../hooks/useCachedFetch";
import { useLiveQuotes, type StreamStatus } from "../hooks/useLiveQuotes";
import { useTickerSearch } from "../hooks/useTickerSearch";
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

type SortKey =
  | "symbol"
  | "last"
  | "change_pct"
  | "rel_volume"
  | "rsi14"
  | "earnings_in_days";

const CACHE_KEY = "watchlist:quotes";

export function Watchlist({ refreshNonce, selected, onSelect }: Props) {
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSuggest, setShowSuggest] = useState(false);
  const [suggestHi, setSuggestHi] = useState(0);
  const suggestions = useTickerSearch(adding);
  const [sortKey, setSortKey] = useState<SortKey>("symbol");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const { quotes: live, status: streamStatus } = useLiveQuotes();

  // Stale-while-revalidate cache: subsequent visits to the Watchlist tab
  // show cached rows immediately and refresh in the background.
  const cache = useCachedFetch<WatchlistQuotesResponse>(
    CACHE_KEY,
    () => api.get("/watchlist/quotes"),
    { refreshMs: REFRESH_MS, staleAfterMs: 30_000 },
  );
  const rows = cache.data?.rows ?? null;
  useEffect(() => {
    if (cache.error) setErr(cache.error);
  }, [cache.error]);

  const sortedRows = useMemo(() => {
    if (!rows) return null;
    const cp = [...rows];
    cp.sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortKey];
      const bv = (b as unknown as Record<string, unknown>)[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const na = Number(av);
      const nb = Number(bv);
      return sortDir === "asc" ? na - nb : nb - na;
    });
    return cp;
  }, [rows, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      // Default to most-useful direction per column
      setSortDir(k === "symbol" ? "asc" : "desc");
    }
  };

  const load = () => {
    clearCacheKey(CACHE_KEY);
    cache.refetch();
  };

  // External "refresh" button bumps refreshNonce; force a fresh pull.
  useEffect(() => {
    if (refreshNonce === 0) return;
    cache.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshNonce]);

  const addSymbol = async (rawSym: string) => {
    const sym = rawSym.trim().toUpperCase();
    if (!sym) return;
    setBusy(true);
    try {
      await api.post("/watchlist", { symbol: sym });
      setAdding("");
      setShowSuggest(false);
      setSuggestHi(0);
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.detail : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onAdd = (e: FormEvent) => {
    e.preventDefault();
    // Enter on the form: prefer the highlighted suggestion if visible,
    // else add whatever the user typed verbatim.
    const pick =
      showSuggest && suggestions[suggestHi]
        ? suggestions[suggestHi].symbol
        : adding;
    void addSymbol(pick);
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
        <form onSubmit={onAdd} className="relative flex items-center gap-2">
          <input
            value={adding}
            onChange={(e) => {
              setAdding(e.target.value);
              setShowSuggest(true);
              setSuggestHi(0);
            }}
            onFocus={() => setShowSuggest(true)}
            onBlur={() => {
              // Delay so a click on a suggestion still fires before close.
              window.setTimeout(() => setShowSuggest(false), 150);
            }}
            onKeyDown={(e) => {
              if (!showSuggest || suggestions.length === 0) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSuggestHi((h) => Math.min(h + 1, suggestions.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSuggestHi((h) => Math.max(h - 1, 0));
              } else if (e.key === "Escape") {
                setShowSuggest(false);
              }
            }}
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
          {showSuggest && adding.trim() && suggestions.length > 0 && (
            <ul
              className="absolute left-0 top-full z-30 mt-1 w-72 max-h-64 overflow-auto rounded-md border border-(--color-border) bg-(--color-panel) shadow-xl"
              role="listbox"
            >
              {suggestions.map((s, i) => (
                <li key={s.symbol}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      void addSymbol(s.symbol);
                    }}
                    onMouseEnter={() => setSuggestHi(i)}
                    className={`flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-xs ${
                      i === suggestHi ? "bg-(--color-panel-2)" : ""
                    }`}
                  >
                    <span className="font-medium">{s.symbol}</span>
                    {s.description && (
                      <span className="truncate text-[10px] text-(--color-text-dim)">
                        {s.description}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
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
              <SortHeader k="symbol" align="left" current={sortKey} dir={sortDir} onClick={toggleSort}>
                Symbol
              </SortHeader>
              <SortHeader k="last" align="right" current={sortKey} dir={sortDir} onClick={toggleSort}>
                Last
              </SortHeader>
              <SortHeader
                k="change_pct"
                align="right"
                current={sortKey}
                dir={sortDir}
                onClick={toggleSort}
                tooltip="Today's percent change vs prior close"
              >
                Change
              </SortHeader>
              <SortHeader
                k="rel_volume"
                align="right"
                current={sortKey}
                dir={sortDir}
                onClick={toggleSort}
                tooltip="Today's volume / 30-day average. > 1.0 = above-average activity"
              >
                Rel Vol
              </SortHeader>
              <SortHeader
                k="rsi14"
                align="right"
                current={sortKey}
                dir={sortDir}
                onClick={toggleSort}
                tooltip="RSI(14): >70 overbought, <30 oversold"
              >
                RSI
              </SortHeader>
              <th className="px-3 py-2 text-left" title="Position within the 52-week trading range">
                52W
              </th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {sortedRows === null
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={7} className="px-3 py-2">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  </tr>
                ))
              : sortedRows.length === 0
                ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-3 py-6 text-center text-sm text-(--color-text-dim)"
                      >
                        Watchlist is empty. Add a ticker above.
                      </td>
                    </tr>
                  )
                : sortedRows.map((r) => {
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

function SortHeader({
  k,
  current,
  dir,
  align,
  onClick,
  tooltip,
  children,
}: {
  k: SortKey;
  current: SortKey;
  dir: "asc" | "desc";
  align: "left" | "right";
  onClick: (k: SortKey) => void;
  tooltip?: string;
  children: ReactNode;
}) {
  const active = current === k;
  return (
    <th className={`px-3 py-2 ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        onClick={() => onClick(k)}
        title={tooltip}
        className={`inline-flex items-center gap-1 ${
          active ? "text-(--color-text)" : ""
        } hover:text-(--color-text)`}
      >
        <span>{children}</span>
        {active && (dir === "asc" ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
      </button>
    </th>
  );
}
