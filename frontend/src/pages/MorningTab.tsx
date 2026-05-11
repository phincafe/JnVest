import { Calendar } from "../components/Calendar";
import { IndexChart } from "../components/IndexChart";
import { KeyEvents } from "../components/KeyEvents";
import { MarketContext } from "../components/MarketContext";
import { MarketMovers } from "../components/MarketMovers";
import { MarketNews } from "../components/MarketNews";
import { SectorRotation } from "../components/SectorRotation";

export default function MorningTab({
  refreshNonce,
  isGuest: _isGuest,
}: {
  refreshNonce: number;
  isGuest: boolean;
}) {
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-4">
      <MarketContext refreshNonce={refreshNonce} />
      <IndexChart />
      <KeyEvents refreshNonce={refreshNonce} />
      <MarketMovers refreshNonce={refreshNonce} />
      <SectorRotation refreshNonce={refreshNonce} />
      <Calendar refreshNonce={refreshNonce} />
      <MarketNews refreshNonce={refreshNonce} />
    </div>
  );
}
