import { useEffect, useState } from "react";
import { LogIn, LogOut, RefreshCcw, Search } from "lucide-react";
import { api } from "../api/client";
import type { SnapTradeHoldings } from "../api/types";
import { changeClass, fmtPrice } from "../lib/format";

type Props = {
  refreshNonce: number;
  onRefresh: () => void;
  onLogout: () => void;
  onLogin?: () => void;
  onSearch?: () => void;
  role?: "owner" | "guest" | null;
};

export function Header({
  refreshNonce,
  onRefresh,
  onLogout,
  onLogin,
  onSearch,
  role,
}: Props) {
  const isGuest = role !== "owner";
  const [equity, setEquity] = useState<number | null>(null);
  const [invested, setInvested] = useState<number | null>(null);
  const [unrealized, setUnrealized] = useState<number | null>(null);
  const [cash, setCash] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Header reflects real broker holdings (SnapTrade) only.
    // Alpaca's $100k paper money is for the order ticket, not your portfolio.
    api
      .get<SnapTradeHoldings>("/snaptrade/holdings")
      .then((snap) => {
        if (cancelled) return;
        setEquity(snap?.totals.equity ?? null);
        setInvested(snap?.totals.invested ?? null);
        setUnrealized(snap?.totals.unrealized_pl ?? null);
        setCash(snap?.totals.cash ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);

  return (
    <header className="sticky top-0 z-20 border-b border-(--color-border) bg-(--color-bg)/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <h1 className="m-0">
            <img
              src="/logo.svg"
              alt="Jnvest"
              className="h-7 w-auto sm:h-8"
            />
          </h1>
          {isGuest && (
            <span
              className="rounded bg-purple-500/30 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-purple-200"
              title="Guest mode — read-only, $ amounts hidden"
            >
              Guest
            </span>
          )}
        </div>

        {isGuest ? null : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums sm:gap-x-5 sm:text-sm">
            <Stat label="Equity" value={equity != null ? `$${fmtPrice(equity)}` : "—"} />
            <Stat
              label="Unrealized"
              value={
                unrealized != null
                  ? `${unrealized >= 0 ? "+" : "-"}$${fmtPrice(Math.abs(unrealized))}`
                  : "—"
              }
              tone={changeClass(unrealized)}
            />
            <Stat
              label="Invested"
              value={invested != null ? `$${fmtPrice(invested)}` : "—"}
              hideOnMobile
            />
            <Stat
              label="Cash"
              value={cash != null ? `$${fmtPrice(cash)}` : "—"}
              hideOnMobile
            />
          </div>
        )}

        <div className="flex items-center gap-1">
          {onSearch && (
            <button
              onClick={onSearch}
              className="hidden items-center gap-1.5 rounded-md border border-(--color-border) px-2.5 py-1.5 text-xs text-(--color-text-dim) hover:text-(--color-text) sm:flex"
              aria-label="Search ticker"
              title="Search ticker (⌘K)"
            >
              <Search size={14} />
              <kbd className="ml-1 hidden rounded border border-(--color-border) px-1 text-[10px] md:inline">
                ⌘K
              </kbd>
            </button>
          )}
          <button
            onClick={onRefresh}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-(--color-border) text-(--color-text-dim) hover:text-(--color-text)"
            aria-label="Refresh data"
            title="Refresh"
          >
            <RefreshCcw size={14} />
          </button>
          {role === "owner" ? (
            <button
              onClick={onLogout}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-(--color-border) text-(--color-text-dim) hover:text-(--color-text)"
              aria-label="Log out"
              title="Log out"
            >
              <LogOut size={14} />
            </button>
          ) : (
            onLogin && (
              <button
                onClick={onLogin}
                className="flex items-center gap-1.5 rounded-md border border-(--color-accent)/60 bg-(--color-accent)/10 px-3 py-1.5 text-xs font-medium text-(--color-accent) hover:bg-(--color-accent)/20"
                aria-label="Owner login"
                title="Owner login"
              >
                <LogIn size={14} /> Owner
              </button>
            )
          )}
        </div>
      </div>
    </header>
  );
}

function Stat({
  label,
  value,
  tone,
  hideOnMobile,
}: {
  label: string;
  value: string;
  tone?: string;
  hideOnMobile?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline gap-1.5 ${hideOnMobile ? "hidden sm:flex" : ""}`}
    >
      <span className="text-[10px] uppercase tracking-wide text-(--color-text-dim)">
        {label}
      </span>
      <span className={`font-medium ${tone ?? ""}`}>{value}</span>
    </div>
  );
}
