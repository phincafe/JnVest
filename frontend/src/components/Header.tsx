import { useEffect, useState } from "react";
import { LogOut, RefreshCcw } from "lucide-react";
import { api } from "../api/client";
import type { AccountSummary, SnapTradeHoldings } from "../api/types";
import { changeClass, fmtPct, fmtPrice } from "../lib/format";

type Props = {
  isPaper: boolean;
  refreshNonce: number;
  onRefresh: () => void;
  onLogout: () => void;
};

export function Header({ isPaper, refreshNonce, onRefresh, onLogout }: Props) {
  const [equity, setEquity] = useState<number | null>(null);
  const [todayPL, setTodayPL] = useState<number | null>(null);
  const [todayPLPct, setTodayPLPct] = useState<number | null>(null);
  const [unrealized, setUnrealized] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api
        .get<SnapTradeHoldings>("/snaptrade/holdings")
        .catch(() => null),
      api.get<AccountSummary>("/positions/account").catch(() => null),
    ]).then(([snap, alp]) => {
      if (cancelled) return;
      const snapEq = snap?.totals.equity ?? 0;
      const alpEq = alp?.equity ?? 0;
      setEquity((snapEq + alpEq) || null);
      // Today's P/L from Alpaca only (SnapTrade doesn't expose intraday).
      setTodayPL(alp?.today_pl ?? null);
      setTodayPLPct(alp?.today_pl_pct ?? null);
      // Unrealized P/L from SnapTrade.
      setUnrealized(snap?.totals.unrealized_pl ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);

  return (
    <header className="sticky top-0 z-20 border-b border-(--color-border) bg-(--color-bg)/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold tracking-tight">JnVest</h1>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
              isPaper
                ? "bg-yellow-600/30 text-yellow-200"
                : "bg-red-600/40 text-red-100"
            }`}
            title={isPaper ? "Paper trading" : "LIVE — order ticket disabled"}
          >
            {isPaper ? "Paper" : "Live"}
          </span>
        </div>

        <div className="flex items-center gap-5 text-xs sm:text-sm tabular-nums">
          <Stat label="Equity" value={equity != null ? `$${fmtPrice(equity)}` : "—"} />
          <Stat
            label="Today"
            value={
              todayPL != null
                ? `${todayPL >= 0 ? "+" : "-"}$${fmtPrice(Math.abs(todayPL))}` +
                  (todayPLPct != null ? ` (${fmtPct(todayPLPct)})` : "")
                : "—"
            }
            tone={changeClass(todayPL)}
          />
          <Stat
            label="Unrealized"
            value={
              unrealized != null
                ? `${unrealized >= 0 ? "+" : "-"}$${fmtPrice(Math.abs(unrealized))}`
                : "—"
            }
            tone={changeClass(unrealized)}
          />
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={onRefresh}
            className="flex items-center gap-1.5 rounded-md border border-(--color-border) px-2.5 py-1.5 text-xs text-(--color-text-dim) hover:text-(--color-text)"
            aria-label="Refresh data"
            title="Refresh"
          >
            <RefreshCcw size={14} />
          </button>
          <button
            onClick={onLogout}
            className="flex items-center gap-1.5 rounded-md border border-(--color-border) px-2.5 py-1.5 text-xs text-(--color-text-dim) hover:text-(--color-text)"
            aria-label="Log out"
            title="Log out"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </header>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-(--color-text-dim)">
        {label}
      </span>
      <span className={`font-medium ${tone ?? ""}`}>{value}</span>
    </div>
  );
}
