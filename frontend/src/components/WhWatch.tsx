/**
 * "White House Watch" — curated sector list of names tied to current US
 * policy/spending priorities (AI, chips, defense, nuclear, etc.). Static
 * by design: this isn't a real-time monitor, it's a "explore this list"
 * jumping-off point. Click a ticker to drill into StockDetail.
 *
 * Edit the GROUPS constant below to add/remove tickers — no API needed.
 */
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

type Group = {
  name: string;
  // Short emoji-like prefix to set the group apart visually.
  glyph: string;
  tickers: string[];
};

const GROUPS: Group[] = [
  { name: "AI", glyph: "✦", tickers: ["GOOGL", "SNBI", "SIREN", "SCRVW"] },
  { name: "Chips", glyph: "✦", tickers: ["TSM", "ASML", "NVDA", "AMD"] },
  { name: "Space", glyph: "✦", tickers: ["RKLB", "ASTS", "LUNR", "RDW"] },
  { name: "Crypto", glyph: "✦", tickers: ["COIN", "BTC", "ETH"] },
  { name: "Energy", glyph: "✦", tickers: ["GEV", "CEG"] },
  { name: "Drones", glyph: "✦", tickers: ["ONDS"] },
  { name: "Nuclear", glyph: "✦", tickers: ["CCJ", "OKLO", "VST"] },
  { name: "Defense", glyph: "✦", tickers: ["KTOS", "SAVA", "SAMT"] },
  { name: "Robotics", glyph: "✦", tickers: ["SYM", "AMZN", "ISRG"] },
  { name: "Batteries", glyph: "✦", tickers: ["STE", "EOSE", "ELVA", "FLNC"] },
  { name: "Quantum", glyph: "✦", tickers: ["QBTS", "IONQ", "RGTI"] },
  { name: "Healthcare", glyph: "✦", tickers: ["GH", "GRAL", "MIRM"] },
  { name: "Data centres", glyph: "✦", tickers: ["VRT", "ANET"] },
  { name: "Critical minerals", glyph: "✦", tickers: ["TMQ", "UUUU", "CCJ"] },
];

type Props = {
  refreshNonce: number;
  /** Click ticker → jump to watchlist tab + open StockDetail. */
  onSelect?: (symbol: string) => void;
};

export function WhWatch({ refreshNonce, onSelect }: Props) {
  void refreshNonce;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (name: string) =>
    setCollapsed((s) => ({ ...s, [name]: !s[name] }));

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium text-(--color-text-dim)">
          WH Watch{" "}
          <span className="text-[10px] uppercase tracking-wide text-(--color-text-dim)/70">
            US policy / spending themes · click any ticker to open
          </span>
        </h2>
      </div>

      <div className="space-y-2">
        {GROUPS.map((g) => {
          const isCollapsed = collapsed[g.name];
          return (
            <div
              key={g.name}
              className="rounded-lg border border-(--color-border) bg-(--color-panel)"
            >
              <button
                type="button"
                onClick={() => toggle(g.name)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
              >
                <span className="flex items-baseline gap-2">
                  <span className="text-(--color-accent)">{g.glyph}</span>
                  <span className="text-sm font-medium">{g.name}</span>
                  <span className="text-[10px] uppercase tracking-wide text-(--color-text-dim)">
                    {g.tickers.length} ticker
                    {g.tickers.length === 1 ? "" : "s"}
                  </span>
                </span>
                {isCollapsed ? (
                  <ChevronRight size={14} className="text-(--color-text-dim)" />
                ) : (
                  <ChevronDown size={14} className="text-(--color-text-dim)" />
                )}
              </button>
              {!isCollapsed && (
                <div className="flex flex-wrap gap-1.5 border-t border-(--color-border) px-3 py-2">
                  {g.tickers.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => onSelect?.(t)}
                      className="rounded-md border border-(--color-border) bg-(--color-panel-2) px-2 py-1 text-xs font-medium tabular-nums hover:border-(--color-accent) hover:text-(--color-accent)"
                    >
                      ${t}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
