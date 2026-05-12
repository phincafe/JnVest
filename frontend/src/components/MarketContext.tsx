import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { IndicesResponse, MacroResponse, SectorsResponse } from "../api/types";
import { IndexTile } from "./IndexTile";
import { MacroTile } from "./MacroTile";
import { SectorHeatmap } from "./SectorHeatmap";
import { Skeleton } from "./Skeleton";

const REFRESH_MS = 60_000;

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      indices: IndicesResponse;
      sectors: SectorsResponse;
      macro: MacroResponse;
      lastUpdated: Date;
    };

type Props = {
  refreshNonce: number;
  /** Click handler for the index/sector/macro tiles. When set, each tile
   * becomes a button that selects that ticker — used by the Morning tab
   * to drive the IndexChart below. */
  onSymbolSelect?: (sym: string) => void;
  /** Currently active symbol (for highlighting the matching tile). */
  selectedSymbol?: string;
};

export function MarketContext({ refreshNonce, onSymbolSelect, selectedSymbol }: Props) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [indices, sectors, macro] = await Promise.all([
          api.get<IndicesResponse>("/market/indices"),
          api.get<SectorsResponse>("/market/sectors"),
          api.get<MacroResponse>("/market/macro"),
        ]);
        if (!cancelled) {
          setState({
            status: "ready",
            indices,
            sectors,
            macro,
            lastUpdated: new Date(),
          });
        }
      } catch (e) {
        if (!cancelled) {
          const message =
            e instanceof ApiError
              ? `${e.status}: ${e.detail}`
              : (e as Error).message;
          setState({ status: "error", message });
        }
      }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [refreshNonce]);

  if (state.status === "loading") {
    return (
      <section>
        <h2 className="mb-3 text-sm font-medium text-(--color-text-dim)">Market context</h2>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="rounded-xl border border-(--color-down)/50 bg-(--color-panel) p-4 text-sm text-(--color-down)">
        Market context failed to load: {state.message}
        <div className="mt-1 text-xs text-(--color-text-dim)">
          Check your Alpaca keys in .env, then click the refresh button.
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-(--color-text-dim)">Market context</h2>
        <span className="text-xs text-(--color-text-dim)">
          Updated {state.lastUpdated.toLocaleTimeString()}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {state.indices.tiles.map((t) => (
          <IndexTile
            key={t.symbol}
            tile={t}
            onSelect={onSymbolSelect}
            active={selectedSymbol === t.symbol}
          />
        ))}
        {Object.entries(state.macro).map(([name, tile]) => (
          <MacroTile
            key={name}
            name={name}
            tile={tile}
            onSelect={onSymbolSelect}
            active={selectedSymbol === tile.symbol}
          />
        ))}
      </div>
      <SectorHeatmap
        tiles={state.sectors.tiles}
        onSelect={onSymbolSelect}
        selectedSymbol={selectedSymbol}
      />
    </section>
  );
}
