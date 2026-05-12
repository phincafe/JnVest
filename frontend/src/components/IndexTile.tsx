import type { IndexTile as IndexTileT } from "../api/types";
import { changeClass, fmtChange, fmtPct, fmtPrice } from "../lib/format";

const LABELS: Record<string, string> = {
  SPY: "S&P 500",
  QQQ: "Nasdaq 100",
  DIA: "Dow",
  IWM: "Russell 2000",
};

type Props = {
  tile: IndexTileT;
  /** When provided, the tile becomes a button that selects this symbol. */
  onSelect?: (sym: string) => void;
  /** Highlight when this tile is the currently selected chart symbol. */
  active?: boolean;
};

export function IndexTile({ tile, onSelect, active }: Props) {
  const label = LABELS[tile.symbol] ?? tile.symbol;
  const Component: "button" | "div" = onSelect ? "button" : "div";
  return (
    <Component
      onClick={onSelect ? () => onSelect(tile.symbol) : undefined}
      className={`block w-full rounded-lg border bg-(--color-panel) p-2.5 text-left transition-colors ${
        active
          ? "border-(--color-accent) ring-1 ring-(--color-accent)/40"
          : "border-(--color-border)"
      } ${onSelect ? "cursor-pointer hover:border-(--color-text-dim)" : ""}`}
    >
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
    </Component>
  );
}
