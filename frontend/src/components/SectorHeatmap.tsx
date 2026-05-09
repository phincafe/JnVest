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
    <div className="rounded-lg border border-(--color-border) bg-(--color-panel) p-2.5">
      <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-(--color-text-dim)">
        Sectors (SPDR ETFs)
      </h3>
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-11">
        {tiles.map((t) => (
          <div
            key={t.symbol}
            className="flex flex-col rounded-md px-1.5 py-1 text-[11px] leading-tight"
            style={{ backgroundColor: bg(t.change_pct) }}
            title={SECTOR_LABELS[t.symbol] ?? t.symbol}
          >
            <span className="font-medium">{t.symbol}</span>
            <span className="tabular-nums">{fmtPct(t.change_pct)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
