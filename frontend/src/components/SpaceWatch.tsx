/**
 * "Space Watch" — curated list of public names riding the SpaceX-IPO hype
 * and the broader space-economy buildout (launch, satellites, lunar, defense
 * primes with major space programs, plus adjacent hype plays).
 *
 * Static by design — same pattern as WhWatch. Edit the GROUPS constant to
 * add/remove tickers; no API call needed.
 */
import { useState } from "react";
import { ChevronDown, ChevronRight, Rocket } from "lucide-react";

type Group = {
  name: string;
  tickers: string[];
};

const GROUPS: Group[] = [
  // Pure-play launch / rocket companies.
  { name: "Launch & rockets", tickers: ["RKLB", "ASTR", "BA"] },
  // Satellite communications + constellations.
  { name: "Satellite comms", tickers: ["ASTS", "IRDM", "VSAT", "GSAT"] },
  // Earth observation / imaging.
  { name: "Earth observation", tickers: ["PL", "BKSY", "SPIR"] },
  // Lunar landers + deep-space services + in-space infrastructure.
  { name: "Lunar & deep space", tickers: ["LUNR", "RDW", "MNTS"] },
  // Defense primes — major US gov't space contractors. They get every
  // big NASA/DOD bid.
  { name: "Defense primes (space)", tickers: ["LMT", "NOC", "RTX", "GD", "LDOS"] },
  // Picks-and-shovels for the space economy (propulsion, ground systems,
  // power, etc.).
  { name: "Suppliers & infrastructure", tickers: ["BWXT", "AJRD", "MRCY"] },
  // Musk-adjacent and "any rocket hype" beneficiaries. Speculative.
  { name: "SpaceX-adjacent hype", tickers: ["TSLA", "PLTR", "STRL"] },
];

type Props = {
  refreshNonce: number;
  /** Click ticker → jump to watchlist tab + open StockDetail. */
  onSelect?: (symbol: string) => void;
};

export function SpaceWatch({ refreshNonce, onSelect }: Props) {
  void refreshNonce;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (name: string) =>
    setCollapsed((s) => ({ ...s, [name]: !s[name] }));

  return (
    <section className="space-y-3">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-(--color-text-dim)">
          <Rocket size={14} className="text-(--color-accent)" />
          Space Watch{" "}
          <span className="text-[10px] uppercase tracking-wide text-(--color-text-dim)/70">
            SpaceX-IPO hype + the space economy · click any ticker to open
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
                  <span className="text-(--color-accent)">✦</span>
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
