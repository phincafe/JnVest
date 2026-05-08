import { Calendar } from "../components/Calendar";
import { IndexChart } from "../components/IndexChart";
import { KeyEvents } from "../components/KeyEvents";
import { MarketContext } from "../components/MarketContext";
import { MarketMovers } from "../components/MarketMovers";
import { MarketNews } from "../components/MarketNews";
import { RecentActivity } from "../components/RecentActivity";

export default function MorningTab({
  refreshNonce,
  isGuest,
}: {
  refreshNonce: number;
  isGuest: boolean;
}) {
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-4">
      <KeyEvents refreshNonce={refreshNonce} />
      <IndexChart />
      <RecentActivity refreshNonce={refreshNonce} isGuest={isGuest} />
      <MarketContext refreshNonce={refreshNonce} />
      <MarketMovers refreshNonce={refreshNonce} />
      <Calendar refreshNonce={refreshNonce} />
      <MarketNews refreshNonce={refreshNonce} />
    </div>
  );
}
