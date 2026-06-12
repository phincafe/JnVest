/** Equity curve — daily snapshots of total SnapTrade account value.
 * Snapshots are recorded server-side whenever holdings are fetched (one per
 * day, latest wins), so the curve fills in as the app is used. Owner-only:
 * the endpoint returns real $ amounts.
 */
import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api/client";
import type { EquityHistoryResponse } from "../api/types";
import { useCachedFetch } from "../hooks/useCachedFetch";
import { changeClass, fmtPrice } from "../lib/format";
import { Skeleton } from "./Skeleton";

const REFRESH_MS = 10 * 60_000;

export function EquityCurve({ refreshNonce }: { refreshNonce: number }) {
  const { data } = useCachedFetch<EquityHistoryResponse>(
    "snaptrade:equity-history",
    () => api.get("/snaptrade/equity-history"),
    { refreshMs: REFRESH_MS, staleAfterMs: 5 * 60_000 },
  );
  void refreshNonce;

  const points = data?.points ?? [];
  const change = useMemo(() => {
    if (points.length < 2) return null;
    const first = points[0].equity;
    const last = points[points.length - 1].equity;
    if (!first) return null;
    return { abs: last - first, pct: ((last - first) / first) * 100 };
  }, [points]);

  if (!data) return <Skeleton className="h-40 w-full" />;
  if (points.length < 2) {
    return (
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-(--color-text-dim)">Equity curve</h2>
        <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4 text-sm text-(--color-text-dim)">
          Collecting daily snapshots — the curve appears after two days of
          data. A snapshot is recorded each day you open the Portfolio tab.
        </div>
      </section>
    );
  }

  const min = Math.min(...points.map((p) => p.equity));
  const max = Math.max(...points.map((p) => p.equity));
  const pad = Math.max((max - min) * 0.1, 1);

  return (
    <section className="space-y-2">
      <h2 className="flex items-baseline gap-2 text-sm font-medium text-(--color-text-dim)">
        Equity curve
        {change && (
          <span className={`text-xs tabular-nums ${changeClass(change.abs)}`}>
            {change.abs >= 0 ? "+" : "-"}${fmtPrice(Math.abs(change.abs))} (
            {change.pct >= 0 ? "+" : ""}
            {change.pct.toFixed(2)}%) since {points[0].date}
          </span>
        )}
      </h2>
      <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
        <div className="h-48 w-full">
          <ResponsiveContainer>
            <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
              <defs>
                <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "var(--color-text-dim)" }}
                tickFormatter={(d: string) => d.slice(5)}
                minTickGap={32}
              />
              <YAxis
                domain={[min - pad, max + pad]}
                tick={{ fontSize: 10, fill: "var(--color-text-dim)" }}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                width={48}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--color-panel-2)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(v: number, name: string) => [`$${fmtPrice(v)}`, name]}
              />
              <Area
                type="monotone"
                dataKey="equity"
                stroke="var(--color-accent)"
                strokeWidth={2}
                fill="url(#equityFill)"
                name="Equity"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-[10px] text-(--color-text-dim)/70">
          One point per day, captured when holdings load. Gaps = days the app
          wasn't opened.
        </p>
      </div>
    </section>
  );
}
