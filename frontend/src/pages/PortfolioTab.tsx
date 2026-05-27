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
      <SnapTradePanel refreshNonce={refreshNonce} isGuest={isGuest} />
      <RecentActivity refreshNonce={refreshNonce} isGuest={isGuest} />
    </div>
  );
}
