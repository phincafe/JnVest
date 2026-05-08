import { useEffect, useMemo, useRef, useState } from "react";
import { Activity } from "lucide-react";
import {
  AreaSeries,
  CandlestickSeries,
  createChart,
  type IChartApi,
} from "lightweight-charts";
import { api } from "../api/client";
import type { Bar } from "../api/types";
import { useCachedFetch } from "../hooks/useCachedFetch";
import { changeClass, fmtPct, fmtPrice } from "../lib/format";
import { Skeleton } from "./Skeleton";

const REFRESH_MS = 15_000; // poll every 15s; IEX bars print on the minute

const INDEXES: { sym: string; label: string }[] = [
  { sym: "SPY", label: "S&P 500" },
  { sym: "QQQ", label: "Nasdaq" },
  { sym: "DIA", label: "Dow" },
  { sym: "IWM", label: "Russell 2K" },
];

const INTERVALS: { value: string; label: string }[] = [
  { value: "1Min", label: "1m" },
  { value: "5Min", label: "5m" },
  { value: "15Min", label: "15m" },
  { value: "30Min", label: "30m" },
];

type Resp = { symbol: string; interval: string; bars: Bar[] };

export function IndexChart() {
  const [symbol, setSymbol] = useState("SPY");
  const [interval, setInterval] = useState("5Min");
  const [chartType, setChartType] = useState<"area" | "candle">("area");

  const { data, isFetching } = useCachedFetch<Resp>(
    `intraday:${symbol}:${interval}`,
    () => api.get(`/market/intraday/${symbol}?interval=${interval}`),
    { refreshMs: REFRESH_MS, staleAfterMs: 5_000 },
  );

  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  // Last bar / change vs prior session close (first bar of today's set).
  const summary = useMemo(() => {
    if (!data?.bars?.length) return null;
    const bars = data.bars;
    const last = bars[bars.length - 1];
    const first = bars[0];
    const open = first.o;
    const change = last.c - open;
    const pct = open ? (change / open) * 100 : 0;
    return { last: last.c, change, pct, bars };
  }, [data]);

  useEffect(() => {
    if (!ref.current || !data?.bars?.length) return;
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
      timeScale: { borderColor: "#232838", timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: "#232838" },
    });
    chartRef.current = chart;

    const tToTime = (t: string) =>
      Math.floor(new Date(t).getTime() / 1000) as unknown as number;

    const bars = data.bars;
    if (chartType === "area") {
      const series = chart.addSeries(AreaSeries, {
        topColor: "rgba(59, 130, 246, 0.4)",
        bottomColor: "rgba(59, 130, 246, 0.02)",
        lineColor: "#3b82f6",
        lineWidth: 2,
      });
      series.setData(
        bars.map((b) => ({
          time: tToTime(b.t),
          value: b.c,
        })) as never,
      );
    } else {
      const series = chart.addSeries(CandlestickSeries, {
        upColor: "#16a34a",
        downColor: "#dc2626",
        borderUpColor: "#16a34a",
        borderDownColor: "#dc2626",
        wickUpColor: "#16a34a",
        wickDownColor: "#dc2626",
      });
      series.setData(
        bars.map((b) => ({
          time: tToTime(b.t),
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
        })) as never,
      );
    }
    chart.timeScale().fitContent();
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [data, chartType]);

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
        </h2>
        <div className="flex flex-wrap items-center gap-1">
          <Picker
            value={symbol}
            options={INDEXES.map((i) => ({ value: i.sym, label: i.label }))}
            onChange={setSymbol}
          />
          <Picker
            value={interval}
            options={INTERVALS}
            onChange={setInterval}
          />
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
        {!data ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div ref={ref} className="h-[260px] w-full sm:h-[320px]" />
        )}
        <div className="mt-1 flex items-center justify-between px-2 text-[10px] text-(--color-text-dim)">
          <span>Updates every 15s · IEX feed (real-time)</span>
          {summary && (
            <span className="tabular-nums">{summary.bars.length} bars</span>
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
