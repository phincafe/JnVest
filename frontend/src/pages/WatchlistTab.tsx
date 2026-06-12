import { useEffect, useState } from "react";
import { ChevronLeft, Search } from "lucide-react";
import { AiWatch } from "../components/AiWatch";
import { AlertsPanel } from "../components/AlertsPanel";
import { QuantumWatch } from "../components/QuantumWatch";
import { SpaceWatch } from "../components/SpaceWatch";
import { WhWatch } from "../components/WhWatch";
import { BuyWatch } from "../components/BuyWatch";
import { StockDetail } from "../components/StockDetail";
import { Watchlist } from "../components/Watchlist";
import { WsbPulse } from "../components/WsbPulse";
import { useTickerSearch } from "../hooks/useTickerSearch";

type Props = {
  refreshNonce: number;
  /** Symbol requested by an external action (e.g. cmd+K). When set, we
   * select it and call onConsumedRequestedSymbol to clear the request. */
  requestedSymbol?: string | null;
  onConsumedRequestedSymbol?: () => void;
  isGuest?: boolean;
};

type ListKey =
  | "holdings"
  | "buy"
  | "ai"
  | "wsb"
  | "wh"
  | "space"
  | "quantum"
  | "alerts";
type ListTab = { key: ListKey; label: string; ownerOnly?: boolean };
const LIST_TABS: ListTab[] = [
  { key: "holdings", label: "Holdings" },
  { key: "buy", label: "Buy Watch" },
  { key: "ai", label: "AI Watch" },
  { key: "wsb", label: "WSB" },
  { key: "wh", label: "WH Watch" },
  { key: "space", label: "Space" },
  { key: "quantum", label: "Quantum" },
  { key: "alerts", label: "Alerts", ownerOnly: true },
];

export default function WatchlistTab({
  refreshNonce,
  requestedSymbol,
  onConsumedRequestedSymbol,
  isGuest = false,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  // Active list in the left column. Tabs at the top let the user jump
  // between Holdings / Buy Watch / AI Watch / WSB without scrolling
  // through all four stacked. Persisted so revisiting the tab doesn't
  // bounce back to Holdings.
  const [activeList, setActiveList] = useState<ListKey>(() => {
    const saved = sessionStorage.getItem("jnv:watchlist-tab") as ListKey | null;
    const valid = LIST_TABS.some((t) => t.key === saved && (!t.ownerOnly || !isGuest));
    return valid && saved ? saved : "holdings";
  });
  useEffect(() => {
    sessionStorage.setItem("jnv:watchlist-tab", activeList);
  }, [activeList]);

  useEffect(() => {
    if (requestedSymbol) {
      setSelected(requestedSymbol);
      onConsumedRequestedSymbol?.();
    }
  }, [requestedSymbol, onConsumedRequestedSymbol]);

  return (
    <div className="mx-auto max-w-[100rem] px-2 py-4 sm:px-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* LEFT column — list switcher tabs, then the active list.
            Hidden on mobile when a symbol is selected so the detail
            panel takes over the screen. */}
        <div className={`${selected ? "hidden lg:block" : "block"} space-y-3`}>
          <div className="flex flex-wrap items-center gap-1 rounded-md border border-(--color-border) bg-(--color-panel) p-1">
            {LIST_TABS.filter((t) => !t.ownerOnly || !isGuest).map((t) => (
              <button
                key={t.key}
                onClick={() => setActiveList(t.key)}
                className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors sm:flex-none ${
                  activeList === t.key
                    ? "bg-(--color-accent) text-white"
                    : "text-(--color-text-dim) hover:text-(--color-text)"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {activeList === "holdings" && (
            <Watchlist
              refreshNonce={refreshNonce}
              selected={selected}
              onSelect={setSelected}
              isGuest={isGuest}
            />
          )}
          {activeList === "buy" && (
            <BuyWatch
              refreshNonce={refreshNonce}
              onSelect={setSelected}
              isGuest={isGuest}
            />
          )}
          {activeList === "ai" && (
            <AiWatch refreshNonce={refreshNonce} onSelect={setSelected} />
          )}
          {activeList === "wh" && (
            <WhWatch refreshNonce={refreshNonce} onSelect={setSelected} />
          )}
          {activeList === "space" && (
            <SpaceWatch refreshNonce={refreshNonce} onSelect={setSelected} />
          )}
          {activeList === "quantum" && (
            <QuantumWatch refreshNonce={refreshNonce} onSelect={setSelected} />
          )}
          {activeList === "alerts" && !isGuest && (
            <AlertsPanel refreshNonce={refreshNonce} />
          )}
          {activeList === "wsb" && (
            <WsbPulse refreshNonce={refreshNonce} onSelect={setSelected} />
          )}
        </div>

        {/* RIGHT column — sticky StockDetail. Stays in view as the user
            scrolls through the four lists on the left, so picking a ticker
            anywhere shows the chart/news/fundamentals without losing
            scroll position. */}
        <div className={selected ? "block" : "hidden lg:block"}>
          <div className="lg:sticky lg:top-[68px]">
            {selected && (
              <button
                onClick={() => setSelected(null)}
                className="mb-3 -ml-1 flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-(--color-text-dim) hover:text-(--color-text) lg:hidden"
                aria-label="Back to lists"
              >
                <ChevronLeft size={16} /> Lists
              </button>
            )}
            {!selected ? (
              <SearchPanel onSelect={setSelected} />
            ) : (
              <StockDetail symbol={selected} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SearchPanel({ onSelect }: { onSelect: (sym: string) => void }) {
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const results = useTickerSearch(q);

  const submit = () => {
    const pick = results[hi]?.symbol ?? q.trim().toUpperCase();
    if (pick) onSelect(pick.toUpperCase());
  };

  return (
    <section className="rounded-xl border border-(--color-border) bg-(--color-panel) p-6">
      <p className="mb-3 text-sm text-(--color-text-dim)">
        Search any ticker to see chart, news, and fundamentals.
      </p>
      <div className="relative">
        <div className="flex items-center gap-2 rounded-md border border-(--color-border) bg-(--color-panel) px-3 py-2 focus-within:border-(--color-accent)">
          <Search size={14} className="text-(--color-text-dim)" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setHi(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setHi((h) => Math.min(h + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHi((h) => Math.max(h - 1, 0));
              }
            }}
            autoFocus
            placeholder="Ticker (e.g. NVDA)"
            className="flex-1 bg-transparent text-sm uppercase placeholder:normal-case placeholder:text-(--color-text-dim)/60 focus:outline-none"
          />
        </div>
        {q.trim() && results.length > 0 && (
          <ul
            className="mt-2 max-h-72 overflow-auto rounded-md border border-(--color-border) bg-(--color-panel-2)"
            role="listbox"
          >
            {results.map((r, i) => (
              <li key={r.symbol}>
                <button
                  type="button"
                  onClick={() => onSelect(r.symbol)}
                  onMouseEnter={() => setHi(i)}
                  className={`flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-xs ${
                    i === hi ? "bg-(--color-panel)" : ""
                  }`}
                >
                  <span className="font-medium">{r.symbol}</span>
                  {r.description && (
                    <span className="truncate text-[11px] text-(--color-text-dim)">
                      {r.description}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
