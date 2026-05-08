import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  createChart,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import type { Bar } from "../api/types";

type Props = {
  bars: Bar[];
  sma20?: (number | null)[];
  sma50?: (number | null)[];
  sma200?: (number | null)[];
  height?: number;
};

function toTime(t: string): Time {
  // Lightweight-charts accepts unix-seconds for intraday and YYYY-MM-DD for daily.
  if (t.length === 10) return t as Time;
  return Math.floor(new Date(t).getTime() / 1000) as Time;
}

export function CandlestickChart({
  bars,
  sma20,
  sma50,
  sma200,
  height = 360,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      autoSize: true,
      layout: {
        background: { color: "#131722" },
        textColor: "#8b93a7",
      },
      grid: {
        vertLines: { color: "#1f2433" },
        horzLines: { color: "#1f2433" },
      },
      timeScale: { borderColor: "#232838" },
      rightPriceScale: { borderColor: "#232838" },
    });
    chartRef.current = chart;

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: "#16a34a",
      downColor: "#dc2626",
      borderUpColor: "#16a34a",
      borderDownColor: "#dc2626",
      wickUpColor: "#16a34a",
      wickDownColor: "#dc2626",
    });
    candle.setData(
      bars.map((b) => ({
        time: toTime(b.t),
        open: b.o,
        high: b.h,
        low: b.l,
        close: b.c,
      })),
    );

    const addSma = (
      values: (number | null)[] | undefined,
      color: string,
    ): ISeriesApi<"Line"> | null => {
      if (!values) return null;
      const s = chart.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      s.setData(
        values
          .map((v, i) =>
            v == null ? null : { time: toTime(bars[i].t), value: v },
          )
          .filter((p): p is { time: Time; value: number } => p !== null),
      );
      return s;
    };

    addSma(sma20, "#3b82f6");
    addSma(sma50, "#f59e0b");
    addSma(sma200, "#a855f7");

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [bars, sma20, sma50, sma200]);

  return <div ref={ref} style={{ height: `${height}px`, width: "100%" }} />;
}
