import { CustomOptionPanel } from "../components/CustomOptionPanel";
import { RecentActivity } from "../components/RecentActivity";
import { SnapTradePanel } from "../components/SnapTradePanel";

export default function PortfolioTab({
  refreshNonce,
  isGuest = false,
}: {
  refreshNonce: number;
  isGuest?: boolean;
}) {
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-4">
      <CustomOptionPanel isGuest={isGuest} />
      {/* Recent activity is rendered as a slot inside SnapTradePanel so it
          appears directly under the Portfolio overview / Public portfolio
          view donuts, before the per-account tables. */}
      <SnapTradePanel
        refreshNonce={refreshNonce}
        isGuest={isGuest}
        afterOverview={
          <RecentActivity refreshNonce={refreshNonce} isGuest={isGuest} />
        }
      />
    </div>
  );
}
