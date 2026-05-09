import { Calendar } from "../components/Calendar";
import { IndexChart } from "../components/IndexChart";
import { KeyEvents } from "../components/KeyEvents";
import { MarketContext } from "../components/MarketContext";
import { MarketMovers } from "../components/MarketMovers";
import { MarketNews } from "../components/MarketNews";
import { SectorRotation } from "../components/SectorRotation";
import { WsbPulse } from "../components/WsbPulse";

export default function MorningTab({
  refreshNonce,
  isGuest: _isGuest,
  onOpenSymbol,
}: {
  refreshNonce: number;
  isGuest: boolean;
  /** When provided, clicking a row in WSB Pulse jumps to the watchlist
   * tab with that symbol selected. */
  onOpenSymbol?: (symbol: string) => void;
}) {
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-4">
      <MarketContext refreshNonce={refreshNonce} />
      <IndexChart />
      <KeyEvents refreshNonce={refreshNonce} />
      <MarketMovers refreshNonce={refreshNonce} />
      <SectorRotation refreshNonce={refreshNonce} />
      <WsbPulse refreshNonce={refreshNonce} onSelect={onOpenSymbol} />
      <Calendar refreshNonce={refreshNonce} />
      <MarketNews refreshNonce={refreshNonce} />
    </div>
  );
}
