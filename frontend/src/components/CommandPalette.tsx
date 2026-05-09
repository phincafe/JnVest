import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { api } from "../api/client";

type Props = {
  open: boolean;
  onClose: () => void;
  onSelect: (symbol: string) => void;
  watchlistSymbols: string[];
};

type Item = { symbol: string; description?: string };
type SearchResp = { results: Item[]; warning?: string };

// Reasonable mega-cap + popular options names so the palette has suggestions
// even before you've typed a full ticker. Anything you type is also accepted
// as a literal symbol.
const SUGGESTIONS = [
  "SPY", "QQQ", "IWM", "DIA",
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA",
  "AMD", "NFLX", "AVGO", "ORCL", "CRM", "ADBE", "INTC", "QCOM",
  "JPM", "BAC", "GS", "MS", "V", "MA",
  "COIN", "MSTR", "PLTR", "SOFI", "RIVN", "RBLX", "HOOD",
  "JNJ", "PFE", "MRK", "ABBV", "LLY", "TMO",
  "XOM", "CVX",
  "BTC-USD", "ETH-USD",
];

export function CommandPalette({ open, onClose, onSelect, watchlistSymbols }: Props) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [apiResults, setApiResults] = useState<Item[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlight(0);
      setApiResults([]);
      // Defer focus until after the DOM paints.
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  // Debounced symbol search — fires 200ms after the user stops typing so we
  // don't spam Finnhub while they're mid-word. Aborts the in-flight fetch
  // when the query changes again.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setApiResults([]);
      return;
    }
    const ctrl = new AbortController();
    const id = window.setTimeout(async () => {
      try {
        const data = await api.get<SearchResp>(
          `/api/market/search?q=${encodeURIComponent(q)}&limit=10`,
        );
        if (!ctrl.signal.aborted) setApiResults(data.results || []);
      } catch {
        if (!ctrl.signal.aborted) setApiResults([]);
      }
    }, 200);
    return () => {
      ctrl.abort();
      window.clearTimeout(id);
    };
  }, [query]);

  const list = useMemo(() => {
    const q = query.trim().toUpperCase();
    const universe: Item[] = Array.from(new Set([...watchlistSymbols, ...SUGGESTIONS])).map(
      (s) => ({ symbol: s }),
    );
    if (!q) return universe.slice(0, 12);

    // Local matches first (instant) — preserves "in watchlist" badging and
    // works when Finnhub is unconfigured / down.
    const exact = universe.filter((u) => u.symbol === q);
    const prefix = universe.filter((u) => u.symbol.startsWith(q) && u.symbol !== q);
    const contains = universe.filter(
      (u) => !u.symbol.startsWith(q) && u.symbol.includes(q),
    );
    const local = [...exact, ...prefix, ...contains];

    // Fold in API hits not already in local. API gives us company names too.
    const localSet = new Set(local.map((u) => u.symbol));
    const fromApi = apiResults.filter((r) => !localSet.has(r.symbol));

    // Backfill descriptions on local items if the API knows them.
    const apiByName = new Map(apiResults.map((r) => [r.symbol, r.description]));
    const localEnriched = local.map((u) => ({
      ...u,
      description: apiByName.get(u.symbol),
    }));

    const merged = [...localEnriched, ...fromApi].slice(0, 12);
    if (merged.length === 0) return [{ symbol: q }];
    return merged;
  }, [query, watchlistSymbols, apiResults]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, list.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = list[highlight]?.symbol ?? query.trim().toUpperCase();
      if (pick) {
        onSelect(pick.toUpperCase());
        onClose();
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[15vh] backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-xl border border-(--color-border) bg-(--color-panel) shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-(--color-border) px-3">
          <Search size={14} className="text-(--color-text-dim)" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search ticker… (Enter to open, Esc to close)"
            className="flex-1 bg-transparent py-3 text-sm uppercase placeholder:normal-case placeholder:text-(--color-text-dim) focus:outline-none"
          />
        </div>
        <ul className="max-h-72 overflow-auto py-1">
          {list.map((item, i) => {
            const sym = item.symbol;
            const isActive = i === highlight;
            const inWatchlist = watchlistSymbols.includes(sym);
            return (
              <li key={sym}>
                <button
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => {
                    onSelect(sym);
                    onClose();
                  }}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${
                    isActive ? "bg-(--color-accent)/15 text-(--color-text)" : "text-(--color-text)"
                  }`}
                >
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="font-medium">{sym}</span>
                    {item.description && (
                      <span className="truncate text-[11px] text-(--color-text-dim)">
                        {item.description}
                      </span>
                    )}
                  </span>
                  {inWatchlist && (
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-(--color-text-dim)">
                      In watchlist
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-between border-t border-(--color-border) px-3 py-2 text-[10px] text-(--color-text-dim)">
          <span>↑↓ navigate · ⏎ open · esc close</span>
          <kbd className="rounded border border-(--color-border) px-1">⌘K</kbd>
        </div>
      </div>
    </div>
  );
}
