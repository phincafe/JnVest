import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, ApiError } from "../api/client";
import type {
  ChainResponse,
  ExpirationsResponse,
  IvSummary,
  OptionRow,
} from "../api/types";
import { Skeleton } from "./Skeleton";

type Props = { symbol: string };
type Side = "calls" | "puts" | "both";

const fmt = (n: number | null | undefined, d = 2) =>
  n == null ? "—" : n.toFixed(d);
const pct = (n: number | null | undefined, d = 1) =>
  n == null ? "—" : `${(n * 100).toFixed(d)}%`;
const ivPct = (iv: number | null) => (iv == null ? "—" : `${(iv * 100).toFixed(1)}%`);

export function OptionsPanel({ symbol }: Props) {
  const [iv, setIv] = useState<IvSummary | null>(null);
  const [exps, setExps] = useState<string[] | null>(null);
  const [exp, setExp] = useState<string | null>(null);
  const [chain, setChain] = useState<ChainResponse | null>(null);
  const [side, setSide] = useState<Side>("both");
  const [err, setErr] = useState<string | null>(null);

  // Load IV summary + expirations in parallel.
  useEffect(() => {
    let cancelled = false;
    setIv(null);
    setExps(null);
    setExp(null);
    setChain(null);
    setErr(null);
    Promise.all([
      api.get<IvSummary>(`/options/${symbol}/iv`),
      api.get<ExpirationsResponse>(`/options/${symbol}/expirations`),
    ])
      .then(([ivR, expsR]) => {
        if (cancelled) return;
        setIv(ivR);
        setExps(expsR.expirations);
        if (expsR.expirations.length > 0) setExp(expsR.expirations[0]);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e instanceof ApiError ? e.detail : (e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  // Load chain when expiration changes.
  useEffect(() => {
    if (!exp) return;
    let cancelled = false;
    setChain(null);
    api
      .get<ChainResponse>(`/options/${symbol}/chain?expiration=${exp}`)
      .then((c) => {
        if (cancelled) return;
        setChain(c);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e instanceof ApiError ? e.detail : (e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, exp]);

  if (err) {
    return (
      <section className="rounded-xl border border-(--color-down)/40 bg-(--color-panel) p-4 text-sm text-(--color-down)">
        Options error: {err}
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium text-(--color-text-dim)">Options</h3>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <IvSummaryCard iv={iv} />
        <TermStructureCard iv={iv} />
        <SkewCard iv={iv} />
      </div>

      <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-3">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <label className="text-xs text-(--color-text-dim)">Expiration</label>
          <select
            value={exp ?? ""}
            onChange={(e) => setExp(e.target.value)}
            disabled={!exps || exps.length === 0}
            className="rounded-md border border-(--color-border) bg-(--color-bg) px-2 py-1 text-xs"
          >
            {exps === null && <option>Loading…</option>}
            {exps && exps.length === 0 && <option>No expirations</option>}
            {exps?.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1 rounded-md border border-(--color-border) p-0.5">
            {(["calls", "puts", "both"] as Side[]).map((s) => (
              <button
                key={s}
                onClick={() => setSide(s)}
                className={`rounded px-2 py-1 text-xs capitalize ${
                  s === side
                    ? "bg-(--color-accent) text-white"
                    : "text-(--color-text-dim) hover:text-(--color-text)"
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          {chain && (
            <div className="ml-auto text-xs text-(--color-text-dim) tabular-nums">
              Spot ${chain.spot.toFixed(2)} · {Math.round(chain.days_to_exp)}d to exp
            </div>
          )}
        </div>

        <ChainTable chain={chain} side={side} spot={chain?.spot ?? 0} />
      </div>
    </section>
  );
}

function IvSummaryCard({ iv }: { iv: IvSummary | null }) {
  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
      <div className="text-xs uppercase tracking-wide text-(--color-text-dim)">
        IV (Front-month ATM)
      </div>
      {!iv ? (
        <Skeleton className="mt-2 h-16 w-full" />
      ) : (
        <>
          <div className="mt-2 text-2xl font-semibold tabular-nums">
            {ivPct(iv.atm_iv)}
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-y-1 text-xs">
            <dt className="text-(--color-text-dim)">IV Rank</dt>
            <dd className="text-right tabular-nums">
              {iv.iv_rank == null
                ? `— (${iv.history_days}d / 30 needed)`
                : `${iv.iv_rank.toFixed(0)}`}
            </dd>
            <dt className="text-(--color-text-dim)">IV Percentile</dt>
            <dd className="text-right tabular-nums">
              {iv.iv_percentile == null ? "—" : `${iv.iv_percentile.toFixed(0)}%`}
            </dd>
          </dl>
        </>
      )}
    </div>
  );
}

function TermStructureCard({ iv }: { iv: IvSummary | null }) {
  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
      <div className="text-xs uppercase tracking-wide text-(--color-text-dim)">
        Term structure (ATM IV)
      </div>
      {!iv ? (
        <Skeleton className="mt-2 h-32 w-full" />
      ) : iv.term_structure.length === 0 ? (
        <div className="mt-2 text-sm text-(--color-text-dim)">No data.</div>
      ) : (
        <div className="mt-2 h-32">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={iv.term_structure.map((t) => ({
                exp: t.expiration.slice(5),
                iv: t.atm_iv * 100,
              }))}
            >
              <CartesianGrid stroke="#1f2433" strokeDasharray="3 3" />
              <XAxis dataKey="exp" stroke="#8b93a7" fontSize={10} />
              <YAxis
                stroke="#8b93a7"
                fontSize={10}
                tickFormatter={(v) => `${v.toFixed(0)}%`}
              />
              <Tooltip
                contentStyle={{ background: "#131722", border: "1px solid #232838" }}
                formatter={(v: number) => `${v.toFixed(1)}%`}
              />
              <Line
                dataKey="iv"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={{ r: 3 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function SkewCard({ iv }: { iv: IvSummary | null }) {
  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
      <div className="text-xs uppercase tracking-wide text-(--color-text-dim)">
        Skew (front month)
      </div>
      {!iv ? (
        <Skeleton className="mt-2 h-32 w-full" />
      ) : iv.skew.length === 0 ? (
        <div className="mt-2 text-sm text-(--color-text-dim)">No data.</div>
      ) : (
        <div className="mt-2 h-32">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={iv.skew.map((s) => ({ strike: s.strike, iv: s.iv * 100 }))}
            >
              <CartesianGrid stroke="#1f2433" strokeDasharray="3 3" />
              <XAxis
                dataKey="strike"
                stroke="#8b93a7"
                fontSize={10}
                type="number"
                domain={["auto", "auto"]}
              />
              <YAxis
                stroke="#8b93a7"
                fontSize={10}
                tickFormatter={(v) => `${v.toFixed(0)}%`}
              />
              <Tooltip
                contentStyle={{ background: "#131722", border: "1px solid #232838" }}
                formatter={(v: number) => `${v.toFixed(1)}%`}
              />
              {iv.spot > 0 && (
                <ReferenceLine x={iv.spot} stroke="#a855f7" strokeDasharray="2 2" />
              )}
              <Line
                dataKey="iv"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function ChainTable({
  chain,
  side,
  spot,
}: {
  chain: ChainResponse | null;
  side: Side;
  spot: number;
}) {
  const merged = useMemo(() => {
    if (!chain) return null;
    if (side === "calls")
      return chain.calls.map((c) => ({ strike: c.strike, call: c, put: null }));
    if (side === "puts")
      return chain.puts.map((p) => ({ strike: p.strike, call: null, put: p }));
    const byStrike = new Map<
      number,
      { strike: number; call: OptionRow | null; put: OptionRow | null }
    >();
    for (const c of chain.calls) byStrike.set(c.strike, { strike: c.strike, call: c, put: null });
    for (const p of chain.puts) {
      const r = byStrike.get(p.strike);
      if (r) r.put = p;
      else byStrike.set(p.strike, { strike: p.strike, call: null, put: p });
    }
    return Array.from(byStrike.values()).sort((a, b) => a.strike - b.strike);
  }, [chain, side]);

  if (!chain || !merged) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (merged.length === 0) {
    return <div className="py-6 text-center text-sm text-(--color-text-dim)">No contracts.</div>;
  }

  return (
    <div className="max-h-96 overflow-auto">
      <table className="min-w-full text-xs">
        <thead className="sticky top-0 z-10 bg-(--color-panel-2) text-(--color-text-dim)">
          <tr>
            {side !== "puts" && <Cols title="Call" />}
            <th className="px-2 py-1.5 text-center font-semibold">Strike</th>
            {side !== "calls" && <Cols title="Put" />}
          </tr>
        </thead>
        <tbody>
          {merged.map(({ strike, call, put }) => {
            const atm = Math.abs(strike - spot) < 0.5;
            return (
              <tr
                key={strike}
                className={`border-t border-(--color-border) ${
                  atm ? "bg-(--color-accent)/10" : ""
                }`}
              >
                {side !== "puts" && <RowCells row={call} />}
                <td className="px-2 py-1 text-center font-medium tabular-nums">
                  {strike.toFixed(2)}
                </td>
                {side !== "calls" && <RowCells row={put} />}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Cols({ title }: { title: string }) {
  return (
    <>
      <th className="px-2 py-1.5 text-right font-medium" colSpan={9}>
        {title}
      </th>
    </>
  );
}

function RowCells({ row }: { row: OptionRow | null }) {
  if (!row) {
    return (
      <>
        {Array.from({ length: 9 }).map((_, i) => (
          <td key={i} className="px-2 py-1 text-right text-(--color-text-dim)">
            —
          </td>
        ))}
      </>
    );
  }
  const unusual = row.unusual_volume ? "text-(--color-up) font-medium" : "";
  return (
    <>
      <td className="px-2 py-1 text-right tabular-nums">{fmt(row.bid)}</td>
      <td className="px-2 py-1 text-right tabular-nums">{fmt(row.ask)}</td>
      <td className="px-2 py-1 text-right tabular-nums">{fmt(row.last)}</td>
      <td className={`px-2 py-1 text-right tabular-nums ${unusual}`}>{row.volume}</td>
      <td className="px-2 py-1 text-right tabular-nums">{row.open_interest}</td>
      <td className="px-2 py-1 text-right tabular-nums">{ivPct(row.iv)}</td>
      <td className="px-2 py-1 text-right tabular-nums">{fmt(row.delta)}</td>
      <td className="px-2 py-1 text-right tabular-nums">{fmt(row.theta)}</td>
      <td className="px-2 py-1 text-right tabular-nums">
        {pct(row.spread_pct == null ? null : row.spread_pct / 100, 1)}
      </td>
    </>
  );
}
