import { useRef, useState } from "react";
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
  // Lift the chart symbol to the page so MarketContext tiles can drive it.
  // Tap any index / sector / macro tile → IndexChart switches + scrolls into view.
  const [chartSymbol, setChartSymbol] = useState("SPY");
  const chartRef = useRef<HTMLDivElement>(null);

  const handleSelectSymbol = (sym: string) => {
    setChartSymbol(sym);
    // Smooth scroll to the chart so the tap is obviously connected.
    requestAnimationFrame(() => {
      chartRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-4">
      <MarketContext
        refreshNonce={refreshNonce}
        onSymbolSelect={handleSelectSymbol}
        selectedSymbol={chartSymbol}
      />
      <div ref={chartRef} className="scroll-mt-4">
        <IndexChart symbol={chartSymbol} onSymbolChange={setChartSymbol} />
      </div>
      <KeyEvents refreshNonce={refreshNonce} />
      <MarketMovers refreshNonce={refreshNonce} />
      <SectorRotation refreshNonce={refreshNonce} />
      <Calendar refreshNonce={refreshNonce} />
      <MarketNews refreshNonce={refreshNonce} />
    </div>
  );
}
