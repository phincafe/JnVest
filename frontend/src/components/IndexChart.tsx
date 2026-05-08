import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Wifi, WifiOff } from "lucide-react";
import {
  AreaSeries,
  CandlestickSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import { api } from "../api/client";
import type { Bar } from "../api/types";
import { useCachedFetch } from "../hooks/useCachedFetch";
import { useLiveQuotes } from "../hooks/useLiveQuotes";
import { changeClass, fmtPct, fmtPrice } from "../lib/format";
import { Skeleton } from "./Skeleton";

const REFRESH_MS = 15_000;

const INDEXES = [
  { sym: "SPY", label: "S&P 500" },
  { sym: "QQQ", label: "Nasdaq" },
  { sym: "DIA", label: "Dow" },
  { sym: "IWM", label: "Russell 2K" },
];

const INTERVALS = [
  { value: "1Min", label: "1m" },
  { value: "5Min", label: "5m" },
  { value: "15Min", label: "15m" },
  { value: "30Min", label: "30m" },
];

type Resp = {
  symbol: string;
  interval: string;
  bars: Bar[];
  prev_close: number | null;
};

const tToTime = (t: string): Time =>
  Math.floor(new Date(t).getTime() / 1000) as unknown as Time;

export function IndexChart() {
  const [symbol, setSymbol] = useState("SPY");
  const [interval, setInterval] = useState("5Min");
  const [chartType, setChartType] = useState<"area" | "candle">("candle");

  const { data: freshData, isFetching } = useCachedFetch<Resp>(
    `intraday:${symbol}:${interval}`,
    () => api.get(`/market/intraday/${symbol}?interval=${interval}`),
    { refreshMs: REFRESH_MS, staleAfterMs: 30_000 },
  );

  // Keep last successful data across symbol/interval changes so the chart
  // doesn't flash a skeleton when the cache key changes.
  const lastDataRef = useRef<Resp | null>(null);
  if (freshData) lastDataRef.current = freshData;
  const data = freshData ?? lastDataRef.current;

  const { quotes: live, status: streamStatus } = useLiveQuotes();
  const liveTick = live.get(symbol);

  const chartContainer = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | ISeriesApi<"Candlestick"> | null>(null);
  const lastBarRef = useRef<Bar | null>(null);

  // Create / destroy the chart on chartType change. Keep the instance alive
  // across data updates so live ticks can mutate the last bar without flicker.
  useEffect(() => {
    if (!chartContainer.current) return;
    const chart = createChart(chartContainer.current, {
      autoSize: true,
      layout: { background: { color: "#131722" }, textColor: "#8b93a7" },
      grid: { vertLines: { color: "#1f2433" }, horzLines: { color: "#1f2433" } },
      timeScale: { borderColor: "#232838", timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: "#232838" },
    });
    chartRef.current = chart;

    if (chartType === "area") {
      seriesRef.current = chart.addSeries(AreaSeries, {
        topColor: "rgba(59, 130, 246, 0.4)",
        bottomColor: "rgba(59, 130, 246, 0.02)",
        lineColor: "#3b82f6",
        lineWidth: 2,
      });
    } else {
      seriesRef.current = chart.addSeries(CandlestickSeries, {
        upColor: "#16a34a",
        downColor: "#dc2626",
        borderUpColor: "#16a34a",
        borderDownColor: "#dc2626",
        wickUpColor: "#16a34a",
        wickDownColor: "#dc2626",
      });
    }
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      lastBarRef.current = null;
    };
  }, [chartType]);

  // Push fresh polled bars into the chart series.
  useEffect(() => {
    if (!seriesRef.current || !data?.bars?.length) return;
    const bars = data.bars;
    if (chartType === "area") {
      (seriesRef.current as ISeriesApi<"Area">).setData(
        bars.map((b) => ({ time: tToTime(b.t), value: b.c })),
      );
    } else {
      (seriesRef.current as ISeriesApi<"Candlestick">).setData(
        bars.map((b) => ({
          time: tToTime(b.t),
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
        })),
      );
    }
    lastBarRef.current = { ...bars[bars.length - 1] };
    chartRef.current?.timeScale().fitContent();
  }, [data, chartType]);

  // Live tick updates: mutate the last bar's close (and high/low) without
  // re-rendering the whole series. This is the "WebSocket streaming" path.
  useEffect(() => {
    if (!seriesRef.current || !liveTick || !lastBarRef.current) return;
    const last = lastBarRef.current;
    last.c = liveTick.price;
    last.h = Math.max(last.h, liveTick.price);
    last.l = Math.min(last.l, liveTick.price);
    if (chartType === "area") {
      (seriesRef.current as ISeriesApi<"Area">).update({
        time: tToTime(last.t),
        value: last.c,
      });
    } else {
      (seriesRef.current as ISeriesApi<"Candlestick">).update({
        time: tToTime(last.t),
        open: last.o,
        high: last.h,
        low: last.l,
        close: last.c,
      });
    }
  }, [liveTick, chartType]);

  // Header summary: change vs PRIOR session close (matches Yahoo/Robinhood),
  // not vs today's first bar open. Falls back to today's first bar if backend
  // didn't supply prev_close (older API or no daily data).
  const summary = useMemo(() => {
    if (!data?.bars?.length) return null;
    const bars = data.bars;
    const baseline = data.prev_close ?? bars[0].o;
    const lastClose = liveTick?.price ?? bars[bars.length - 1].c;
    const change = lastClose - baseline;
    const pct = baseline ? (change / baseline) * 100 : 0;
    return { last: lastClose, change, pct, count: bars.length };
  }, [data, liveTick]);

  const isLive = streamStatus === "live";

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium text-(--color-text-dim)">
          <Activity
            size={14}
            className={isFetching ? "animate-pulse text-(--color-up)" : ""}
          />
          Intraday — {symbol}
          {summary && (
            <span className="ml-2 flex items-baseline gap-2 tabular-nums">
              <span className="text-base font-semibold text-(--color-text)">
                ${fmtPrice(summary.last)}
              </span>
              <span className={`text-xs font-medium ${changeClass(summary.pct)}`}>
                {summary.change >= 0 ? "+" : ""}
                {fmtPrice(summary.change)} ({fmtPct(summary.pct)})
              </span>
            </span>
          )}
          <span
            className="ml-2 flex items-center gap-1 text-[10px] text-(--color-text-dim)"
            title={
              isLive
                ? "WebSocket connected — last bar updates in real-time"
                : "WebSocket disconnected — polling every 15s"
            }
          >
            {isLive ? (
              <Wifi size={11} className="text-(--color-up)" />
            ) : (
              <WifiOff size={11} />
            )}
            {isLive ? "Live" : "Polling"}
          </span>
        </h2>
        <div className="flex flex-wrap items-center gap-1">
          <Picker
            value={symbol}
            options={INDEXES.map((i) => ({ value: i.sym, label: i.label }))}
            onChange={setSymbol}
          />
          <Picker value={interval} options={INTERVALS} onChange={setInterval} />
          <div className="flex items-center gap-0 rounded-md border border-(--color-border) bg-(--color-panel) p-0.5">
            <ChartTypeBtn
              active={chartType === "area"}
              onClick={() => setChartType("area")}
            >
              Area
            </ChartTypeBtn>
            <ChartTypeBtn
              active={chartType === "candle"}
              onClick={() => setChartType("candle")}
            >
              Candle
            </ChartTypeBtn>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-2">
        {/* Always render the chart container so the createChart effect has a
            target on first mount. Overlay a skeleton while data loads. */}
        <div className="relative h-[260px] w-full sm:h-[320px]">
          <div ref={chartContainer} className="absolute inset-0" />
          {!data && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Skeleton className="h-full w-full" />
            </div>
          )}
        </div>
        <div className="mt-1 flex items-center justify-between px-2 text-[10px] text-(--color-text-dim)">
          <span>
            {isLive
              ? "Real-time via Alpaca WebSocket (IEX feed)"
              : "Polled every 15s · IEX feed"}
          </span>
          {summary && (
            <span className="tabular-nums">{summary.count} bars</span>
          )}
        </div>
      </div>
    </section>
  );
}

function Picker({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-(--color-border) bg-(--color-panel) px-2 py-1 text-xs"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function ChartTypeBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-2 py-1 text-xs ${
        active
          ? "bg-(--color-accent) text-white"
          : "text-(--color-text-dim) hover:text-(--color-text)"
      }`}
    >
      {children}
    </button>
  );
}
