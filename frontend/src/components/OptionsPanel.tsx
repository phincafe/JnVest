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

      {iv?.warning && (
        <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-2 text-xs text-yellow-200">
          {iv.warning}
        </div>
      )}

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
                formatter={(v) => (typeof v === "number" ? `${v.toFixed(1)}%` : "—")}
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
                formatter={(v) => (typeof v === "number" ? `${v.toFixed(1)}%` : "—")}
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

  // Robinhood-style: when "both", show only the most useful columns per side
  // (Bid / Ask / Last / Vol / IV / Delta), ITM-shaded background, ATM ring.
  const compact = side === "both";

  return (
    <div className="max-h-[28rem] overflow-auto rounded-lg border border-(--color-border)">
      <table className="min-w-full text-xs">
        <thead className="sticky top-0 z-10 bg-(--color-panel-2) text-[10px] uppercase tracking-wide text-(--color-text-dim)">
          <tr>
            {side !== "puts" && (
              <SideHeader title="Calls" align="right" compact={compact} />
            )}
            <th className="px-3 py-2 text-center font-semibold text-(--color-text)">
              Strike
            </th>
            {side !== "calls" && (
              <SideHeader title="Puts" align="left" compact={compact} />
            )}
          </tr>
        </thead>
        <tbody>
          {merged.map(({ strike, call, put }) => {
            const atm = Math.abs(strike - spot) < 0.5;
            const callItm = !!call && spot > strike;
            const putItm = !!put && spot < strike;
            return (
              <tr
                key={strike}
                className={`border-t border-(--color-border)/60 ${
                  atm ? "outline outline-1 outline-(--color-accent)/60" : ""
                }`}
              >
                {side !== "puts" && (
                  <RowCells row={call} itm={callItm} compact={compact} />
                )}
                <td
                  className={`sticky left-1/2 z-[1] px-3 py-2 text-center text-sm tabular-nums ${
                    atm
                      ? "bg-(--color-accent)/15 font-bold text-(--color-text)"
                      : "bg-(--color-panel) font-semibold"
                  }`}
                >
                  {strike.toFixed(strike >= 100 ? 0 : 2)}
                </td>
                {side !== "calls" && (
                  <RowCells row={put} itm={putItm} compact={compact} />
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SideHeader({
  title,
  align,
  compact,
}: {
  title: string;
  align: "left" | "right";
  compact: boolean;
}) {
  const cols = compact ? ["Bid", "Ask", "Last", "Vol", "IV", "Δ"] : ["Bid", "Ask", "Last", "Vol", "OI", "IV", "Δ", "Θ", "Sprd%"];
  const headers = align === "right" ? [title, ...cols] : [...cols, title];
  // The title cell merges via colspan visually; render headers in line.
  return (
    <>
      {headers.map((h, i) => (
        <th
          key={`${align}-${i}`}
          className={`px-2 py-2 ${align === "right" ? "text-right" : "text-left"} font-medium`}
        >
          {h}
        </th>
      ))}
    </>
  );
}

function RowCells({
  row,
  itm,
  compact,
}: {
  row: OptionRow | null;
  itm: boolean;
  compact: boolean;
}) {
  const cellBg = itm ? "bg-(--color-up)/10" : "";
  const colCount = compact ? 6 : 9;
  if (!row) {
    return (
      <>
        {Array.from({ length: colCount + 1 }).map((_, i) => (
          <td key={i} className={`px-2 py-2 text-right text-(--color-text-dim) ${cellBg}`}>
            —
          </td>
        ))}
      </>
    );
  }
  const unusual = row.unusual_volume ? "text-(--color-up) font-medium" : "";
  if (compact) {
    return (
      <>
        <td className={`px-2 py-2 text-right tabular-nums ${cellBg}`}>{fmt(row.bid)}</td>
        <td className={`px-2 py-2 text-right tabular-nums ${cellBg}`}>{fmt(row.ask)}</td>
        <td className={`px-2 py-2 text-right tabular-nums ${cellBg}`}>{fmt(row.last)}</td>
        <td className={`px-2 py-2 text-right tabular-nums ${unusual} ${cellBg}`}>
          {row.volume}
        </td>
        <td className={`px-2 py-2 text-right tabular-nums ${cellBg}`}>{ivPct(row.iv)}</td>
        <td className={`px-2 py-2 text-right tabular-nums ${cellBg}`}>{fmt(row.delta)}</td>
        <td className={`px-2 py-2 text-right text-(--color-text-dim) ${cellBg}`}></td>
      </>
    );
  }
  return (
    <>
      <td className={`px-2 py-2 text-right tabular-nums ${cellBg}`}>{fmt(row.bid)}</td>
      <td className={`px-2 py-2 text-right tabular-nums ${cellBg}`}>{fmt(row.ask)}</td>
      <td className={`px-2 py-2 text-right tabular-nums ${cellBg}`}>{fmt(row.last)}</td>
      <td className={`px-2 py-2 text-right tabular-nums ${unusual} ${cellBg}`}>
        {row.volume}
      </td>
      <td className={`px-2 py-2 text-right tabular-nums ${cellBg}`}>{row.open_interest}</td>
      <td className={`px-2 py-2 text-right tabular-nums ${cellBg}`}>{ivPct(row.iv)}</td>
      <td className={`px-2 py-2 text-right tabular-nums ${cellBg}`}>{fmt(row.delta)}</td>
      <td className={`px-2 py-2 text-right tabular-nums ${cellBg}`}>{fmt(row.theta)}</td>
      <td className={`px-2 py-2 text-right tabular-nums ${cellBg}`}>
        {pct(row.spread_pct == null ? null : row.spread_pct / 100, 1)}
      </td>
      <td className={`px-2 py-2 text-right text-(--color-text-dim) ${cellBg}`}></td>
    </>
  );
}
