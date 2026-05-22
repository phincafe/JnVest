import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, ApiError } from "../api/client";
import type { ChainResponse, OptionRow, SnapTradeOption } from "../api/types";
import { fmtPrice } from "../lib/format";
import { optionPnL } from "../lib/blackScholes";
import { Skeleton } from "./Skeleton";

type Props = {
  option: SnapTradeOption | null;
  onClose: () => void;
  /** Guest mode: hide $ amounts. Y-axis, tooltip, and stats become % of
   * premium paid; the X-axis (stock price) stays in $ since it's a public
   * market price, not the user's position. */
  isGuest?: boolean;
};

type ChartPoint = {
  spot: number;
  today: number;
  half: number | null;
  expiry: number;
};

export function OptionPnLModal({ option, onClose, isGuest = false }: Props) {
  const [chain, setChain] = useState<ChainResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Close on Escape — matches the pattern used by LoginModal / CommandPalette.
  useEffect(() => {
    if (!option) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [option, onClose]);

  // Fetch the chain for this expiration so we can pull current IV + spot for
  // the same strike. The /chain endpoint enriches every row with IV; cheaper
  // than adding a new single-strike endpoint.
  useEffect(() => {
    if (!option || !option.underlying || !option.expiration) return;
    let cancelled = false;
    setChain(null);
    setErr(null);
    const url = `/options/${option.underlying}/chain?expiration=${option.expiration}`;
    api
      .get<ChainResponse>(url)
      .then((c) => {
        if (!cancelled) setChain(c);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setErr(e instanceof ApiError ? e.message : "Failed to load chain");
      });
    return () => {
      cancelled = true;
    };
  }, [option]);

  const isCall = (option?.option_type ?? "").toLowerCase() === "call";
  const matchedRow: OptionRow | null = useMemo(() => {
    if (!chain || !option || option.strike == null) return null;
    const rows = isCall ? chain.calls : chain.puts;
    const strike = option.strike;
    return rows.find((r) => Math.abs(r.strike - strike) < 1e-6) ?? null;
  }, [chain, option, isCall]);

  const iv = matchedRow?.iv ?? null;
  const spot = chain?.spot ?? null;
  const daysToExp = chain?.days_to_exp ?? null;

  const ready =
    !!option &&
    iv != null &&
    iv > 0 &&
    spot != null &&
    spot > 0 &&
    daysToExp != null &&
    daysToExp > 0 &&
    option.strike != null &&
    option.avg_cost != null;

  const chartData: ChartPoint[] = useMemo(() => {
    if (
      !option ||
      !ready ||
      spot == null ||
      daysToExp == null ||
      iv == null ||
      option.strike == null ||
      option.avg_cost == null
    ) {
      return [];
    }
    const strike = option.strike;
    const avgCost = option.avg_cost;
    const qty = option.quantity;
    // X range: symmetric ±35% around max(spot, strike). Wide enough to cover
    // far-OTM options without the chart clipping the interesting region.
    const center = Math.max(spot, strike);
    const lo = Math.max(0.01, center * 0.65);
    const hi = center * 1.35;
    const N = 60;
    const step = (hi - lo) / (N - 1);
    const showHalf = daysToExp >= 3;
    const halfDays = daysToExp / 2;
    const pts: ChartPoint[] = [];
    for (let i = 0; i < N; i++) {
      const s = lo + i * step;
      pts.push({
        spot: s,
        today: optionPnL({
          spot: s,
          strike,
          iv,
          daysToExp,
          isCall,
          qty,
          avgCost,
        }),
        half: showHalf
          ? optionPnL({
              spot: s,
              strike,
              iv,
              daysToExp: halfDays,
              isCall,
              qty,
              avgCost,
            })
          : null,
        expiry: optionPnL({
          spot: s,
          strike,
          iv,
          daysToExp: 0,
          isCall,
          qty,
          avgCost,
        }),
      });
    }
    return pts;
  }, [ready, spot, daysToExp, iv, isCall, option]);

  if (!option) return null;

  // Breakeven at expiration (long position; for shorts it's the same formula
  // but the side of the curve that's profitable flips). For ATM-ish strikes
  // this is just strike ± premium.
  const breakeven =
    option.strike != null && option.avg_cost != null
      ? isCall
        ? option.strike + option.avg_cost
        : option.strike - option.avg_cost
      : null;

  const showHalfLine = daysToExp != null && daysToExp >= 3;

  // Cost basis in $ — used to express P/L as a % of premium when isGuest hides
  // raw $ amounts. abs() so the formula works for short positions too (qty < 0).
  const costBasis =
    option.avg_cost != null
      ? Math.abs(option.quantity * option.avg_cost * 100)
      : null;
  const fmtPnL = (n: number) => {
    if (isGuest && costBasis) {
      const pct = (n / costBasis) * 100;
      return `${pct >= 0 ? "+" : "-"}${Math.abs(pct).toFixed(0)}%`;
    }
    return `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(0)}`;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[8vh] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-xl border border-(--color-border) bg-(--color-panel) shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-(--color-border) px-5 py-4">
          <div>
            <div className="text-base font-semibold">
              {option.underlying} ${option.strike}{" "}
              <span className="capitalize">
                {option.option_type?.toLowerCase()}
              </span>{" "}
              <span className="text-sm font-normal text-(--color-text-dim)">
                · {option.expiration}
              </span>
            </div>
            <div className="mt-1 text-xs text-(--color-text-dim)">
              {option.quantity > 0 ? "Long" : "Short"} {Math.abs(option.quantity)} @ $
              {option.avg_cost != null ? fmtPrice(option.avg_cost) : "—"}
              {iv != null && ` · IV ${(iv * 100).toFixed(1)}%`}
              {daysToExp != null && ` · ${Math.round(daysToExp)}d to expiry`}
              {spot != null && ` · spot $${fmtPrice(spot)}`}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-(--color-text-dim) hover:bg-(--color-panel-2) hover:text-(--color-text)"
          >
            <X size={18} />
          </button>
        </header>

        <div className="p-5">
          <StatsRow
            currentPL={option.unrealized_pl}
            currentPLPct={option.unrealized_pl_pct}
            breakeven={breakeven}
            qty={option.quantity}
            avgCost={option.avg_cost}
            spot={spot}
            isGuest={isGuest}
          />

          {err && (
            <div className="rounded-md border border-(--color-down)/50 bg-(--color-down)/10 px-3 py-2 text-sm text-(--color-down)">
              {err}
            </div>
          )}

          {!err && !ready && (
            <div className="space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-64 w-full" />
            </div>
          )}

          {ready && chartData.length > 0 && (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ top: 10, right: 16, bottom: 10, left: 0 }}
                >
                  <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="spot"
                    type="number"
                    domain={["dataMin", "dataMax"]}
                    tick={<SpotTick spot={spot ?? 0} />}
                    height={42}
                    stroke="var(--color-text-dim)"
                    fontSize={11}
                  />
                  <YAxis
                    tickFormatter={(v) => fmtPnL(v)}
                    stroke="var(--color-text-dim)"
                    fontSize={11}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--color-panel-2)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    labelFormatter={(v) => {
                      const s = Number(v);
                      const pct = spot ? ((s - spot) / spot) * 100 : null;
                      return pct != null
                        ? `Spot $${s.toFixed(2)} (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)`
                        : `Spot $${s.toFixed(2)}`;
                    }}
                    formatter={(value: number, name: string) => [
                      fmtPnL(value),
                      name,
                    ]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceLine
                    y={0}
                    stroke="var(--color-text-dim)"
                    strokeWidth={1}
                  />
                  {spot != null && (
                    <ReferenceLine
                      x={spot}
                      stroke="var(--color-accent)"
                      strokeDasharray="4 4"
                      label={{
                        value: "spot",
                        fill: "var(--color-accent)",
                        fontSize: 10,
                        position: "top",
                      }}
                    />
                  )}
                  {option.strike != null && (
                    <ReferenceLine
                      x={option.strike}
                      stroke="var(--color-text-dim)"
                      strokeDasharray="2 4"
                      label={{
                        value: "strike",
                        fill: "var(--color-text-dim)",
                        fontSize: 10,
                        position: "top",
                      }}
                    />
                  )}
                  {breakeven != null && (
                    <ReferenceLine
                      x={breakeven}
                      stroke="var(--color-up)"
                      strokeDasharray="4 4"
                      label={{
                        value: "B/E",
                        fill: "var(--color-up)",
                        fontSize: 10,
                        position: "top",
                      }}
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey="today"
                    name="Today"
                    stroke="var(--color-accent)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  {showHalfLine && (
                    <Line
                      type="monotone"
                      dataKey="half"
                      name="Halfway"
                      stroke="#a78bfa"
                      strokeWidth={1.5}
                      dot={false}
                      isAnimationActive={false}
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey="expiry"
                    name="Expiration"
                    stroke="var(--color-text-dim)"
                    strokeWidth={1.5}
                    strokeDasharray="5 3"
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <p className="mt-3 text-[11px] text-(--color-text-dim)">
            Projection uses Black-Scholes with a 5% risk-free rate, 0% dividend
            yield, and current IV held constant. Real P/L will differ as IV
            moves.
          </p>
        </div>
      </div>
    </div>
  );
}

// Custom X-axis tick: shows the dollar spot on the first line and its %
// change vs the current spot on the second. Plain Recharts tickFormatter
// can't render two lines, so we draw the <g><text>…</text></g> ourselves.
function SpotTick({
  x,
  y,
  payload,
  spot,
}: {
  x?: number;
  y?: number;
  payload?: { value: number };
  spot: number;
}) {
  if (x == null || y == null || !payload) return null;
  const v = payload.value;
  const pct = spot > 0 ? ((v - spot) / spot) * 100 : null;
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        dy={14}
        textAnchor="middle"
        fill="var(--color-text-dim)"
        fontSize={11}
      >
        ${Math.round(v)}
      </text>
      {pct != null && (
        <text
          x={0}
          y={0}
          dy={28}
          textAnchor="middle"
          fill="var(--color-text-dim)"
          fontSize={9}
          opacity={0.75}
        >
          {pct >= 0 ? "+" : ""}
          {pct.toFixed(0)}%
        </text>
      )}
    </g>
  );
}

function StatsRow({
  currentPL,
  currentPLPct,
  breakeven,
  qty,
  avgCost,
  spot,
  isGuest,
}: {
  currentPL: number | null;
  currentPLPct: number | null;
  breakeven: number | null;
  qty: number;
  avgCost: number | null;
  spot: number | null;
  isGuest: boolean;
}) {
  const isLong = qty > 0;
  // Long: max loss = premium paid. Short: max profit = premium collected,
  // max loss is undefined for naked positions (∞ for calls, strike*100 for puts).
  const premium = avgCost != null ? avgCost * 100 * Math.abs(qty) : null;
  const maxLossLabel = isLong ? "Max loss" : "Max profit";

  // Current P/L: drop the $ in guest mode — the % already conveys the change.
  const currentPLValue =
    currentPL == null
      ? "—"
      : isGuest
        ? currentPLPct != null
          ? `${currentPLPct >= 0 ? "+" : ""}${currentPLPct.toFixed(1)}%`
          : "—"
        : `${currentPL >= 0 ? "+" : "-"}$${fmtPrice(Math.abs(currentPL))}`;
  const currentPLSub =
    isGuest || currentPLPct == null
      ? null
      : `${currentPLPct >= 0 ? "+" : ""}${currentPLPct.toFixed(1)}%`;

  // Breakeven: render as % distance from current spot in guest mode so the
  // raw price doesn't leak the user's strike via subtraction.
  const breakevenValue =
    breakeven == null
      ? "—"
      : isGuest && spot && spot > 0
        ? (() => {
            const pct = ((breakeven - spot) / spot) * 100;
            return `${pct >= 0 ? "+" : "-"}${Math.abs(pct).toFixed(1)}%`;
          })()
        : `$${fmtPrice(breakeven)}`;
  const breakevenSub = isGuest ? "from spot" : null;

  // Max loss / profit: for guest, it's always 100% of premium for the long
  // side and the short side's premium collected. Just say "100%".
  const maxLossValue =
    premium == null
      ? "—"
      : isGuest
        ? "100%"
        : `$${fmtPrice(premium)}`;

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
      <Stat
        label="Current P/L"
        value={currentPLValue}
        sub={currentPLSub}
        tone={currentPL == null ? "dim" : currentPL >= 0 ? "up" : "down"}
      />
      <Stat label="Breakeven" value={breakevenValue} sub={breakevenSub} />
      <Stat
        label={maxLossLabel}
        value={maxLossValue}
        sub={isLong ? "premium paid" : "premium collected"}
      />
      <Stat
        label="Contracts"
        value={`${Math.abs(qty)} × 100`}
        sub={isLong ? "long" : "short"}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string | null;
  tone?: "default" | "up" | "down" | "dim";
}) {
  const toneClass =
    tone === "up"
      ? "text-(--color-up)"
      : tone === "down"
        ? "text-(--color-down)"
        : tone === "dim"
          ? "text-(--color-text-dim)"
          : "";
  return (
    <div className="rounded-md border border-(--color-border) bg-(--color-panel-2) px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-(--color-text-dim)">
        {label}
      </div>
      <div className={`tabular-nums ${toneClass}`}>{value}</div>
      {sub && (
        <div className="text-[10px] text-(--color-text-dim)">{sub}</div>
      )}
    </div>
  );
}
