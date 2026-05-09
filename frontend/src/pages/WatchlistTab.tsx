import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { StockDetail } from "../components/StockDetail";
import { Watchlist } from "../components/Watchlist";

type Props = {
  refreshNonce: number;
  /** Symbol requested by an external action (e.g. cmd+K). When set, we
   * select it and call onConsumedRequestedSymbol to clear the request. */
  requestedSymbol?: string | null;
  onConsumedRequestedSymbol?: () => void;
  isGuest?: boolean;
};

export default function WatchlistTab({
  refreshNonce,
  requestedSymbol,
  onConsumedRequestedSymbol,
  isGuest = false,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (requestedSymbol) {
      setSelected(requestedSymbol);
      onConsumedRequestedSymbol?.();
    }
  }, [requestedSymbol, onConsumedRequestedSymbol]);

  return (
    <div className="mx-auto max-w-[100rem] px-2 py-4 sm:px-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div
          className={`${selected ? "hidden lg:block" : "block"} lg:sticky lg:top-[68px] lg:self-start`}
        >
          <Watchlist
            refreshNonce={refreshNonce}
            selected={selected}
            onSelect={setSelected}
            isGuest={isGuest}
          />
        </div>
        <div className={selected ? "block" : "hidden lg:block"}>
          {selected && (
            <button
              onClick={() => setSelected(null)}
              className="mb-3 -ml-1 flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-(--color-text-dim) hover:text-(--color-text) lg:hidden"
              aria-label="Back to watchlist"
            >
              <ChevronLeft size={16} /> Watchlist
            </button>
          )}
          <StockDetail symbol={selected} />
        </div>
      </div>
    </div>
  );
}
