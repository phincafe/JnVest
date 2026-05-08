import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { SnapTradeHoldings } from "../api/types";

type Slice = {
  label: string;
  /** % of the parent category (stocks-pie or options-pie). Sums to 100 within each pie. */
  pct: number;
  /** % of the entire portfolio (used in the legend, not the pie). */
  pct_of_portfolio: number;
};

// Two distinct palettes so it's instantly clear which pie is stocks vs options.
const STOCK_PALETTE = [
  "#3b82f6", "#6366f1", "#06b6d4", "#0ea5e9", "#14b8a6", "#10b981",
  "#22c55e", "#84cc16", "#64748b", "#94a3b8", "#475569", "#1e40af",
];
const OPTION_PALETTE = [
  "#a855f7", "#ec4899", "#f97316", "#f59e0b", "#d946ef", "#ef4444",
  "#eab308", "#fb7185", "#c084fc", "#fdba74", "#facc15", "#7c3aed",
];

const TOP_N = 10;

function bucketLongTail(slices: Slice[]): Slice[] {
  if (slices.length <= TOP_N) return slices;
  const head = slices.slice(0, TOP_N);
  const tail = slices.slice(TOP_N);
  const tailPct = tail.reduce((s, x) => s + x.pct, 0);
  const tailPctPort = tail.reduce((s, x) => s + x.pct_of_portfolio, 0);
  return [
    ...head,
    {
      label: `Other (${tail.length})`,
      pct: tailPct,
      pct_of_portfolio: tailPctPort,
    },
  ];
}

export function GuestPortfolioView({ holdings }: { holdings: SnapTradeHoldings }) {
  // Total portfolio % per category (lets us label "Stocks: 78% of portfolio")
  const stockPctOfPortfolio = holdings.positions.reduce(
    (s, p) => s + (p.allocation_pct ?? 0),
    0,
  );
  const optionPctOfPortfolio = holdings.options.reduce(
    (s, o) => s + (o.allocation_pct ?? 0),
    0,
  );

  const stockSlices = useMemo(() => {
    const raw = holdings.positions
      .filter((p) => (p.allocation_pct ?? 0) > 0)
      .map<Slice>((p) => ({
        label: p.ticker ?? "—",
        pct: stockPctOfPortfolio
          ? ((p.allocation_pct ?? 0) / stockPctOfPortfolio) * 100
          : 0,
        pct_of_portfolio: p.allocation_pct ?? 0,
      }))
      .sort((a, b) => b.pct - a.pct);
    return bucketLongTail(raw);
  }, [holdings.positions, stockPctOfPortfolio]);

  const optionSlices = useMemo(() => {
    const raw = holdings.options
      .filter((o) => (o.allocation_pct ?? 0) > 0)
      .map<Slice>((o) => {
        const sym =
          o.option_type && o.strike != null && o.expiration
            ? `${o.underlying} $${o.strike}${o.option_type[0].toUpperCase()} ${o.expiration}`
            : (o.underlying ?? "—");
        return {
          label: sym,
          pct: optionPctOfPortfolio
            ? ((o.allocation_pct ?? 0) / optionPctOfPortfolio) * 100
            : 0,
          pct_of_portfolio: o.allocation_pct ?? 0,
        };
      })
      .sort((a, b) => b.pct - a.pct);
    return bucketLongTail(raw);
  }, [holdings.options, optionPctOfPortfolio]);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-medium text-(--color-text-dim)">
          Public portfolio view
        </h2>
        <p className="mt-1 text-xs text-(--color-text-dim)">
          What&apos;s held + portfolio weight (%). $ amounts and per-account
          breakdowns are hidden.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CategoryCard
          title="Stocks"
          subtitle={`${stockPctOfPortfolio.toFixed(1)}% of portfolio · ${holdings.positions.length} holding${holdings.positions.length === 1 ? "" : "s"}`}
          slices={stockSlices}
          palette={STOCK_PALETTE}
        />
        <CategoryCard
          title="Options"
          subtitle={`${optionPctOfPortfolio.toFixed(1)}% of portfolio · ${holdings.options.length} contract${holdings.options.length === 1 ? "" : "s"}`}
          slices={optionSlices}
          palette={OPTION_PALETTE}
        />
      </div>

      {holdings.positions.length > 0 && (
        <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
          <h3 className="mb-3 text-xs uppercase tracking-wide text-(--color-text-dim)">
            All stocks ({holdings.positions.length})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-(--color-text-dim)">
                <tr>
                  <th className="text-left font-normal">Symbol</th>
                  <th className="text-right font-normal">Weight (portfolio)</th>
                </tr>
              </thead>
              <tbody>
                {holdings.positions.map((p, i) => (
                  <tr key={i} className="border-t border-(--color-border)">
                    <td className="py-1.5 font-medium">{p.ticker ?? "—"}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {p.allocation_pct != null
                        ? `${p.allocation_pct.toFixed(2)}%`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {holdings.options.length > 0 && (
        <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
          <h3 className="mb-3 text-xs uppercase tracking-wide text-(--color-text-dim)">
            All options ({holdings.options.length})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-(--color-text-dim)">
                <tr>
                  <th className="text-left font-normal">Underlying</th>
                  <th className="text-left font-normal">Type</th>
                  <th className="text-right font-normal">Strike</th>
                  <th className="text-left font-normal pl-3">Exp</th>
                  <th className="text-right font-normal">Weight (portfolio)</th>
                </tr>
              </thead>
              <tbody>
                {holdings.options.map((o, i) => (
                  <tr key={i} className="border-t border-(--color-border)">
                    <td className="py-1.5 font-medium">{o.underlying ?? "—"}</td>
                    <td className="py-1.5 capitalize">
                      {o.option_type?.toLowerCase() ?? "—"}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {o.strike != null ? `$${o.strike}` : "—"}
                    </td>
                    <td className="py-1.5 pl-3 text-xs tabular-nums">
                      {o.expiration ?? "—"}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {o.allocation_pct != null
                        ? `${o.allocation_pct.toFixed(2)}%`
                        : "—"}
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

function CategoryCard({
  title,
  subtitle,
  slices,
  palette,
}: {
  title: string;
  subtitle: string;
  slices: Slice[];
  palette: string[];
}) {
  if (slices.length === 0) {
    return (
      <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
        <header className="mb-3">
          <h3 className="text-base font-semibold">{title}</h3>
          <p className="text-xs text-(--color-text-dim)">{subtitle}</p>
        </header>
        <p className="py-8 text-center text-sm text-(--color-text-dim)">
          None held.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
      <header className="mb-3">
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="text-xs text-(--color-text-dim)">{subtitle}</p>
      </header>

      <div className="mb-2 text-[10px] uppercase tracking-wide text-(--color-text-dim)">
        Allocation by position
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="pct"
                nameKey="label"
                innerRadius={45}
                outerRadius={85}
                paddingAngle={1}
                isAnimationActive={false}
              >
                {slices.map((_, i) => (
                  <Cell
                    key={i}
                    fill={palette[i % palette.length]}
                    stroke="#131722"
                    strokeWidth={1}
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: "#131722",
                  border: "1px solid #232838",
                  fontSize: 12,
                }}
                formatter={(v: number, _name: string, item) => {
                  const s = item.payload as Slice;
                  return [
                    `${v.toFixed(2)}% of ${title.toLowerCase()} (${s.pct_of_portfolio.toFixed(2)}% of portfolio)`,
                    s.label,
                  ];
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <ul className="max-h-56 space-y-1.5 overflow-auto text-xs">
          {slices.slice(0, 12).map((s, i) => (
            <li key={i} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: palette[i % palette.length] }}
                />
                <span className="truncate font-medium">{s.label}</span>
              </span>
              <span className="shrink-0 tabular-nums text-(--color-text-dim)">
                {s.pct.toFixed(1)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
