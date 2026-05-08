import { OrderTicket } from "../components/OrderTicket";
import { Positions } from "../components/Positions";
import { SnapTradePanel } from "../components/SnapTradePanel";

export default function PortfolioTab({
  refreshNonce,
  isPaper,
  onSubmittedOrder,
}: {
  refreshNonce: number;
  isPaper: boolean;
  onSubmittedOrder: () => void;
}) {
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-4">
      <SnapTradePanel refreshNonce={refreshNonce} />
      <Positions refreshNonce={refreshNonce} />
      <OrderTicket isPaper={isPaper} onSubmitted={onSubmittedOrder} />
    </div>
  );
}
