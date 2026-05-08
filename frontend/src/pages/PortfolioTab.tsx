import { SnapTradePanel } from "../components/SnapTradePanel";

export default function PortfolioTab({ refreshNonce }: { refreshNonce: number }) {
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-4">
      <SnapTradePanel refreshNonce={refreshNonce} />
      {/* Manual positions section temporarily hidden — re-enable by importing
          ManualPositions from "../components/ManualPositions" and rendering it. */}
    </div>
  );
}
