import type { IndexTile } from "../api/types";
import { fmtPct } from "../lib/format";

const SECTOR_LABELS: Record<string, string> = {
  XLK: "Tech",
  XLF: "Financials",
  XLV: "Health Care",
  XLY: "Consumer Disc.",
  XLP: "Consumer Stap.",
  XLE: "Energy",
  XLI: "Industrials",
  XLB: "Materials",
  XLU: "Utilities",
  XLRE: "Real Estate",
  XLC: "Comm. Services",
};

function bg(pct: number): string {
  // Clamp to ±3% and map to opacity.
  const clamped = Math.max(-3, Math.min(3, pct));
  const alpha = (Math.abs(clamped) / 3) * 0.85 + 0.1;
  if (clamped >= 0) {
    return `rgba(22, 163, 74, ${alpha.toFixed(2)})`;
  }
  return `rgba(220, 38, 38, ${alpha.toFixed(2)})`;
}

type Props = { tiles: IndexTile[] };

export function SectorHeatmap({ tiles }: Props) {
  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
      <h3 className="mb-3 text-sm font-medium text-(--color-text-dim)">
        Sectors (SPDR ETFs)
      </h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {tiles.map((t) => (
          <div
            key={t.symbol}
            className="rounded-lg p-2 text-sm"
            style={{ backgroundColor: bg(t.change_pct) }}
          >
            <div className="font-medium">{t.symbol}</div>
            <div className="text-xs text-white/80">
              {SECTOR_LABELS[t.symbol] ?? ""}
            </div>
            <div className="mt-1 tabular-nums">{fmtPct(t.change_pct)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
