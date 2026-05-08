import { Calendar } from "../components/Calendar";
import { MarketContext } from "../components/MarketContext";

export default function MorningTab({ refreshNonce }: { refreshNonce: number }) {
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-4">
      <MarketContext refreshNonce={refreshNonce} />
      <Calendar refreshNonce={refreshNonce} />
    </div>
  );
}
