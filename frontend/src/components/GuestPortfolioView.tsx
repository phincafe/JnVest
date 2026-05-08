import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { SnapTradeHoldings } from "../api/types";

type Slice = {
  label: string;
  pct: number;
  ticker: string;
  kind: "stock" | "option";
};

// 18-step palette so up to ~18 slices each get a distinct hue. Beyond that we
// roll over (visually fine since overlapping slices end up adjacent on the pie).
const PALETTE = [
  "#3b82f6", "#a855f7", "#ec4899", "#f97316", "#f59e0b", "#84cc16",
  "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9", "#6366f1", "#8b5cf6",
  "#d946ef", "#ef4444", "#22c55e", "#eab308", "#64748b", "#94a3b8",
];

export function GuestPortfolioView({ holdings }: { holdings: SnapTradeHoldings }) {
  const slices: Slice[] = useMemo(() => {
    const out: Slice[] = [];
    for (const p of holdings.positions) {
      if (!p.allocation_pct) continue;
      out.push({
        label: p.ticker ?? "—",
        pct: p.allocation_pct,
        ticker: p.ticker ?? "—",
        kind: "stock",
      });
    }
    for (const o of holdings.options) {
      if (!o.allocation_pct) continue;
      const sym =
        o.option_type && o.strike != null && o.expiration
          ? `${o.underlying} $${o.strike}${o.option_type[0].toUpperCase()}`
          : (o.underlying ?? "—");
      out.push({
        label: sym,
        pct: o.allocation_pct,
        ticker: o.underlying ?? "—",
        kind: "option",
      });
    }
    return out.sort((a, b) => b.pct - a.pct);
  }, [holdings]);

  // Bucket the long tail so the pie doesn't get unreadable.
  const TOP_N = 12;
  const pieData = useMemo(() => {
    if (slices.length <= TOP_N) return slices;
    const head = slices.slice(0, TOP_N);
    const tail = slices.slice(TOP_N);
    const otherPct = tail.reduce((s, x) => s + x.pct, 0);
    return [
      ...head,
      { label: `Other (${tail.length})`, pct: otherPct, ticker: "OTHER", kind: "stock" as const },
    ];
  }, [slices]);

  const stocks = holdings.positions;
  const options = holdings.options;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-medium text-(--color-text-dim)">
          Public portfolio view
        </h2>
        <p className="mt-1 text-xs text-(--color-text-dim)">
          Showing what&apos;s held + portfolio weight (%). $ amounts and per-account
          breakdowns are hidden.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Pie chart */}
        <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
          <h3 className="mb-2 text-xs uppercase tracking-wide text-(--color-text-dim)">
            Allocation by position
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="pct"
                  nameKey="label"
                  innerRadius={50}
                  outerRadius={95}
                  paddingAngle={1}
                  isAnimationActive={false}
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} stroke="#131722" strokeWidth={1} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: "#131722", border: "1px solid #232838", fontSize: 12 }}
                  formatter={(v: number) => `${v.toFixed(2)}%`}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Compact legend */}
        <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
          <h3 className="mb-2 text-xs uppercase tracking-wide text-(--color-text-dim)">
            Top holdings
          </h3>
          <ul className="max-h-64 space-y-1.5 overflow-auto text-sm">
            {pieData.slice(0, 14).map((s, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
                  />
                  <span className="truncate font-medium">{s.label}</span>
                </span>
                <span className="shrink-0 tabular-nums text-(--color-text-dim)">
                  {s.pct.toFixed(2)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {stocks.length > 0 && (
        <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
          <h3 className="mb-3 text-xs uppercase tracking-wide text-(--color-text-dim)">
            Stocks ({stocks.length})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-(--color-text-dim)">
                <tr>
                  <th className="text-left font-normal">Symbol</th>
                  <th className="text-right font-normal">Weight</th>
                </tr>
              </thead>
              <tbody>
                {stocks.map((p, i) => (
                  <tr key={i} className="border-t border-(--color-border)">
                    <td className="py-1.5 font-medium">{p.ticker ?? "—"}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {p.allocation_pct != null ? `${p.allocation_pct.toFixed(2)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {options.length > 0 && (
        <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
          <h3 className="mb-3 text-xs uppercase tracking-wide text-(--color-text-dim)">
            Options ({options.length})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-(--color-text-dim)">
                <tr>
                  <th className="text-left font-normal">Underlying</th>
                  <th className="text-left font-normal">Type</th>
                  <th className="text-right font-normal">Strike</th>
                  <th className="text-left font-normal pl-3">Exp</th>
                  <th className="text-right font-normal">Weight</th>
                </tr>
              </thead>
              <tbody>
                {options.map((o, i) => (
                  <tr key={i} className="border-t border-(--color-border)">
                    <td className="py-1.5 font-medium">{o.underlying ?? "—"}</td>
                    <td className="py-1.5 capitalize">
                      {o.option_type?.toLowerCase() ?? "—"}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {o.strike != null ? `$${o.strike}` : "—"}
                    </td>
                    <td className="py-1.5 pl-3 text-xs tabular-nums">{o.expiration ?? "—"}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {o.allocation_pct != null ? `${o.allocation_pct.toFixed(2)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
