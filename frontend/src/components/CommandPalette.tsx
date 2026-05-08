import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  onSelect: (symbol: string) => void;
  watchlistSymbols: string[];
};

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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlight(0);
      // Defer focus until after the DOM paints.
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  const list = useMemo(() => {
    const q = query.trim().toUpperCase();
    const universe = Array.from(new Set([...watchlistSymbols, ...SUGGESTIONS]));
    if (!q) return universe.slice(0, 12);
    const exact = universe.filter((s) => s.toUpperCase() === q);
    const prefix = universe.filter((s) => s.toUpperCase().startsWith(q) && s.toUpperCase() !== q);
    const contains = universe.filter(
      (s) => !s.toUpperCase().startsWith(q) && s.toUpperCase().includes(q),
    );
    const merged = [...exact, ...prefix, ...contains].slice(0, 12);
    if (merged.length === 0) return [q]; // accept whatever the user typed
    return merged;
  }, [query, watchlistSymbols]);

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
      const pick = list[highlight] ?? query.trim().toUpperCase();
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
          {list.map((sym, i) => {
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
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                    isActive ? "bg-(--color-accent)/15 text-(--color-text)" : "text-(--color-text)"
                  }`}
                >
                  <span className="font-medium">{sym}</span>
                  {inWatchlist && (
                    <span className="text-[10px] uppercase tracking-wide text-(--color-text-dim)">
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
