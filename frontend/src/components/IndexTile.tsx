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
    <div className="rounded-lg border border-(--color-border) bg-(--color-panel) p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-(--color-text-dim)">
          {label}
        </span>
        <span className="text-[10px] text-(--color-text-dim)">{tile.symbol}</span>
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums leading-tight">
        {fmtPrice(tile.last)}
      </div>
      <div className={`text-[11px] tabular-nums ${changeClass(tile.change)}`}>
        {fmtChange(tile.change)} ({fmtPct(tile.change_pct)})
      </div>
    </div>
  );
}
