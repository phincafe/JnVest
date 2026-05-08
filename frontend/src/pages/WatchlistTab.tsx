import { useState } from "react";
import { StockDetail } from "../components/StockDetail";
import { Watchlist } from "../components/Watchlist";

export default function WatchlistTab({ refreshNonce }: { refreshNonce: number }) {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-[100rem] px-2 py-4 sm:px-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="lg:sticky lg:top-[68px] lg:self-start">
          <Watchlist
            refreshNonce={refreshNonce}
            selected={selected}
            onSelect={setSelected}
          />
        </div>
        <div>
          <StockDetail symbol={selected} />
        </div>
      </div>
    </div>
  );
}
