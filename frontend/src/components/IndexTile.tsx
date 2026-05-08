import type { IndexTile as IndexTileT } from "../api/types";
import { changeClass, fmtChange, fmtPct, fmtPrice } from "../lib/format";

const LABELS: Record<string, string> = {
  SPY: "S&P 500",
  QQQ: "Nasdaq 100",
  DIA: "Dow",
  IWM: "Russell 2000",
};

type Props = { tile: IndexTileT };

export function IndexTile({ tile }: Props) {
  const label = LABELS[tile.symbol] ?? tile.symbol;
  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-(--color-text-dim)">
          {label}
        </span>
        <span className="text-xs text-(--color-text-dim)">{tile.symbol}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">
        {fmtPrice(tile.last)}
      </div>
      <div className={`mt-1 text-sm tabular-nums ${changeClass(tile.change)}`}>
        {fmtChange(tile.change)} ({fmtPct(tile.change_pct)})
      </div>
    </div>
  );
}
