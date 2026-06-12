import { createContext, Fragment, useCallback, useContext, useEffect, useState } from "react";
import { Check, ExternalLink, ListPlus, Pencil, RefreshCcw, Trash2, X } from "lucide-react";
import { api, ApiError } from "../api/client";
import type {
  SnapTradeAccount,
  SnapTradeAuthorization,
  SnapTradeHoldings,
  SnapTradeOption,
  SnapTradeOrder,
  SnapTradeStock,
} from "../api/types";
import { useCachedFetch, clearCacheKey, mutateCache } from "../hooks/useCachedFetch";
import { changeClass, fmtPct, fmtPrice } from "../lib/format";
import { ErBadge } from "./ErBadge";
import { GuestPortfolioView } from "./GuestPortfolioView";
import { OptionPnLModal } from "./OptionPnLModal";
import { UpdatedAgo } from "./UpdatedAgo";
import { Skeleton } from "./Skeleton";

// Lets any owned-options table open the P/L modal without threading a callback
// through AggregatedDetail / SelectedAccountDetail / AccountSection /
// GuestPortfolioView. Provider sits at the SnapTradePanel root; modal state
// lives there too. Exported so GuestPortfolioView can consume it.
export const OptionSelectionContext = createContext<
  ((o: SnapTradeOption) => void) | null
>(null);

const REFRESH_MS = 5 * 60_000;

/** Add per-position allocation_pct (% of invested) and totals.cash_pct so the
 * GuestPortfolioView donuts can render against owner data — same component,
 * just sourced from $ values instead of pre-computed weights. */
function withAllocationPcts(h: SnapTradeHoldings): SnapTradeHoldings {
  const invested =
    h.positions.reduce((s, p) => s + (p.market_value || 0), 0) +
    h.options.reduce((s, o) => s + (o.market_value || 0), 0);
  const cash = h.totals?.cash || 0;
  const total = invested + cash;
  return {
    ...h,
    positions: h.positions.map((p) => ({
      ...p,
      allocation_pct: invested ? ((p.market_value || 0) / invested) * 100 : 0,
    })),
    options: h.options.map((o) => ({
      ...o,
      allocation_pct: invested ? ((o.market_value || 0) / invested) * 100 : 0,
    })),
    totals: {
      ...h.totals,
      cash_pct: total ? (cash / total) * 100 : null,
    },
  };
}

export function SnapTradePanel({
  refreshNonce,
  isGuest = false,
  afterOverview,
}: {
  refreshNonce: number;
  isGuest?: boolean;
  /** Slot rendered immediately after the Portfolio overview / Public
   * portfolio view donuts and before the per-account chips. The Portfolio
   * tab uses this to drop Recent activity right under the overview. */
  afterOverview?: React.ReactNode;
}) {
  const [needsCfg, setNeedsCfg] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Persisted so switching app tabs doesn't reset the account drilldown.
  const [selectedAccountId, setSelectedAccountIdRaw] = useState<string>(
    () => sessionStorage.getItem("jnv:snaptrade-account") ?? "all",
  );
  const setSelectedAccountId = (id: string) => {
    sessionStorage.setItem("jnv:snaptrade-account", id);
    setSelectedAccountIdRaw(id);
  };
  const [selectedOption, setSelectedOption] = useState<SnapTradeOption | null>(
    null,
  );

  // Stale-while-revalidate caches keep data on screen across tab switches and
  // refreshNonce bumps. The skeleton only shows on the very first load.
  const authsCache = useCachedFetch<{ authorizations: SnapTradeAuthorization[] }>(
    "snaptrade:auths",
    () => api.get("/snaptrade/authorizations"),
    { refreshMs: REFRESH_MS, staleAfterMs: 60_000 },
  );
  const holdingsCache = useCachedFetch<SnapTradeHoldings>(
    "snaptrade:holdings",
    () => api.get("/snaptrade/holdings"),
    { refreshMs: REFRESH_MS, staleAfterMs: 60_000 },
  );

  const auths = authsCache.data?.authorizations ?? null;
  const holdings = holdingsCache.data;
  const loadingFirst =
    !holdings && (holdingsCache.isFetching || authsCache.isFetching);
  const isRefreshing = holdingsCache.isFetching || authsCache.isFetching;

  // Detect "not configured" 400 from any of the underlying calls.
  useEffect(() => {
    const errMsg = holdingsCache.error || authsCache.error;
    if (errMsg && errMsg.includes("not configured")) {
      setNeedsCfg(true);
      setErr(null);
    } else if (errMsg) {
      setErr(errMsg);
    } else {
      setErr(null);
    }
  }, [holdingsCache.error, authsCache.error]);

  // External "refresh" button bumps refreshNonce; force a cache invalidation.
  useEffect(() => {
    if (refreshNonce === 0) return;
    clearCacheKey("snaptrade:auths");
    clearCacheKey("snaptrade:holdings");
    authsCache.refetch();
    holdingsCache.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshNonce]);

  const load = useCallback(() => {
    authsCache.refetch();
    holdingsCache.refetch();
  }, [authsCache, holdingsCache]);

  const connect = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.get<{ url: string }>("/snaptrade/login-link");
      window.open(r.url, "snaptrade-link", "width=900,height=700");
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) setNeedsCfg(true);
      else setErr(e instanceof ApiError ? e.detail : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (authId: string) => {
    if (!confirm("Disconnect this brokerage from JnVest?")) return;
    setBusy(true);
    try {
      await api.delete(`/snaptrade/authorizations/${authId}`);
      await load();
    } finally {
      setBusy(false);
    }
  };

  // When the backend auto-adds tickers to the watchlist (because new positions
  // appeared in your accounts), show a small toast so you know about it.
  const [autoAddedNotice, setAutoAddedNotice] = useState<string | null>(null);
  useEffect(() => {
    const added = holdings?.auto_added_to_watchlist;
    if (added && added.length > 0) {
      const tail = added.slice(0, 4).join(", ") + (added.length > 4 ? "…" : "");
      setAutoAddedNotice(
        `Added ${added.length} new ticker${added.length === 1 ? "" : "s"} to watchlist: ${tail}`,
      );
      const id = setTimeout(() => setAutoAddedNotice(null), 8_000);
      return () => clearTimeout(id);
    }
  }, [holdings?.auto_added_to_watchlist]);

  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const syncToWatchlist = async () => {
    setBusy(true);
    setSyncMsg(null);
    try {
      const r = await api.post<{ added: number; skipped_existing: number; tickers: string[] }>(
        "/snaptrade/sync-watchlist",
      );
      const tail = r.tickers.length ? ` (${r.tickers.slice(0, 5).join(", ")}${r.tickers.length > 5 ? "…" : ""})` : "";
      setSyncMsg(
        `Added ${r.added} ticker${r.added === 1 ? "" : "s"} to watchlist${tail}. ${r.skipped_existing} already there.`,
      );
    } catch (e) {
      setErr(e instanceof ApiError ? e.detail : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Guest view: a different layout entirely. Pie chart + simple weight tables.
  // Use the auth-derived `isGuest` prop (not holdings?.guest) so we never flash
  // owner-only buttons (Connect broker, Sync, etc.) during the holdings fetch.
  if (isGuest) {
    if (!holdings) {
      return <Skeleton className="h-64 w-full" />;
    }
    return (
      <OptionSelectionContext.Provider value={setSelectedOption}>
        <OptionPnLModal
          option={selectedOption}
          onClose={() => setSelectedOption(null)}
          isGuest
        />
        <GuestPortfolioView holdings={holdings} />
        {afterOverview}
      </OptionSelectionContext.Provider>
    );
  }

  return (
    <OptionSelectionContext.Provider value={setSelectedOption}>
    <section className="space-y-3">
      <OptionPnLModal
        option={selectedOption}
        onClose={() => setSelectedOption(null)}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-baseline gap-2 text-sm font-medium text-(--color-text-dim)">
          Brokerages
          <UpdatedAgo fetchedAt={holdingsCache.fetchedAt} />
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={syncToWatchlist}
            disabled={busy || needsCfg || (auths?.length ?? 0) === 0}
            title="Add every stock + option underlying you hold to the watchlist"
            className="flex items-center gap-1 rounded-md border border-(--color-border) px-2 py-1.5 text-xs hover:bg-(--color-panel-2) disabled:opacity-50"
          >
            <ListPlus size={12} />
            <span className="hidden sm:inline">Sync to watchlist</span>
            <span className="sm:hidden">Sync</span>
          </button>
          <button
            onClick={load}
            disabled={busy}
            className="flex items-center gap-1 rounded-md border border-(--color-border) px-2 py-1.5 text-xs text-(--color-text-dim) hover:text-(--color-text)"
            aria-label="Refresh"
            title={isRefreshing ? "Refreshing in background…" : "Refresh now"}
          >
            <RefreshCcw size={12} className={isRefreshing ? "animate-spin" : ""} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <button
            onClick={connect}
            disabled={busy || needsCfg}
            className="flex items-center gap-1 rounded-md bg-(--color-accent) px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-50 sm:px-3"
          >
            <ExternalLink size={12} />
            <span className="hidden sm:inline">Connect broker</span>
            <span className="sm:hidden">Connect</span>
          </button>
        </div>
      </div>

      {syncMsg && (
        <div className="rounded-md border border-(--color-up)/40 bg-(--color-panel-2) p-2 text-xs text-(--color-up)">
          {syncMsg}
        </div>
      )}

      {autoAddedNotice && (
        <div className="flex items-center justify-between rounded-md border border-(--color-accent)/40 bg-(--color-accent)/10 p-2 text-xs text-(--color-accent)">
          <span>{autoAddedNotice}</span>
          <button
            onClick={() => setAutoAddedNotice(null)}
            className="text-(--color-text-dim) hover:text-(--color-text)"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {needsCfg && (
        <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs text-yellow-200">
          SnapTrade not configured. Sign up free at{" "}
          <a
            className="underline"
            href="https://dashboard.snaptrade.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            dashboard.snaptrade.com
          </a>{" "}
          → copy your <code>clientId</code> and <code>consumerKey</code> into{" "}
          <code>.env</code> as <code>SNAPTRADE_CLIENT_ID</code> and{" "}
          <code>SNAPTRADE_CONSUMER_KEY</code>, then reload.
        </div>
      )}

      {err && (
        <div className="rounded-md border border-(--color-down)/40 bg-(--color-panel) p-2 text-xs text-(--color-down)">
          {err}
        </div>
      )}

      {!needsCfg && (
        <>
          {loadingFirst && auths === null ? (
            <Skeleton className="h-20" />
          ) : auths === null ? (
            <Skeleton className="h-20" />
          ) : auths.length === 0 ? (
            <div className="rounded-xl border border-dashed border-(--color-border) bg-(--color-panel) p-6 text-center text-sm text-(--color-text-dim)">
              No brokerages connected. Click "Connect broker" — a SnapTrade
              window opens; pick Robinhood, Schwab, etc., authorize, and come
              back here.
            </div>
          ) : (
            <>
              {holdings && <TotalsCard totals={holdings.totals} />}
              {holdings && (
                <GuestPortfolioView
                  ownerMode
                  holdings={withAllocationPcts(holdings)}
                />
              )}
              {afterOverview}
              {holdings && (
                <AccountChips
                  accounts={holdings.accounts}
                  positions={holdings.positions}
                  options={holdings.options}
                  selected={selectedAccountId}
                  onSelect={setSelectedAccountId}
                  detailNode={
                    <SelectedAccountDetail
                      selectedId={selectedAccountId}
                      holdings={holdings}
                      auths={auths}
                      onDisconnect={disconnect}
                      busy={busy}
                    />
                  }
                />
              )}
            </>
          )}
        </>
      )}
    </section>
    </OptionSelectionContext.Provider>
  );
}

function AccountChips({
  accounts,
  positions,
  options,
  selected,
  onSelect,
  detailNode,
}: {
  accounts: SnapTradeAccount[];
  positions: SnapTradeStock[];
  options: SnapTradeOption[];
  selected: string;
  onSelect: (id: string) => void;
  /** Rendered inline in the same grid right after the selected chip,
   * spanning the full row so it visually attaches to its account. */
  detailNode?: React.ReactNode;
}) {
  const totalEq = accounts.reduce((s, a) => s + (a.equity || a.balance || 0), 0);
  const totalCash = accounts.reduce((s, a) => s + (a.cash || 0), 0);
  const totalInvested =
    positions.reduce((s, p) => s + p.market_value, 0) +
    options.reduce((s, o) => s + o.market_value, 0);
  const totalOpenPl = accounts.reduce((s, a) => s + (a.open_pl || 0), 0);
  const totalOpenCost = Math.max(totalInvested - totalOpenPl, 0);
  const totalOpenPlPct = totalOpenCost ? (totalOpenPl / totalOpenCost) * 100 : null;
  const totalTodayPl = accounts.reduce((s, a) => s + (a.today_pl || 0), 0);
  const totalTodayBase = Math.max(totalEq - totalTodayPl, 0);
  const totalTodayPlPct = totalTodayBase ? (totalTodayPl / totalTodayBase) * 100 : null;
  const allTodayComplete = accounts.every((a) => a.today_pl_complete);
  const [sort, setSort] = useState<"equity" | "name" | "broker">("equity");

  const sorted = [...accounts].sort((a, b) => {
    if (sort === "equity") return (b.balance || 0) - (a.balance || 0);
    if (sort === "name") return a.name.localeCompare(b.name);
    return (a.broker || "").localeCompare(b.broker || "");
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end">
        <label className="text-[11px] text-(--color-text-dim)">
          Sort by{" "}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="ml-1 rounded border border-(--color-border) bg-(--color-panel) px-1.5 py-0.5"
          >
            <option value="equity">Equity</option>
            <option value="name">Name</option>
            <option value="broker">Broker</option>
          </select>
        </label>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <Chip
          active={selected === "all"}
          onClick={() => onSelect("all")}
          title="All accounts"
          subtitle={`${accounts.length} brokerage${accounts.length === 1 ? "" : "s"}`}
          amount={`$${fmtPrice(totalEq)}`}
          todayPl={totalTodayPl}
          todayPlPct={totalTodayPlPct}
          todayComplete={allTodayComplete}
          openPl={totalOpenPl}
          openPlPct={totalOpenPlPct}
          invested={totalInvested}
          cash={totalCash}
        />
        {selected === "all" && detailNode && (
          <div className="col-span-full mt-1">{detailNode}</div>
        )}
        {sorted.map((a) => (
          <Fragment key={a.id}>
            <Chip
              active={selected === a.id}
              onClick={() => onSelect(a.id)}
              title={a.name}
              subtitle={a.broker + (a.type ? ` · ${a.type}` : "")}
              amount={`$${fmtPrice(a.balance || 0)}`}
              todayPl={a.today_pl}
              todayPlPct={a.today_pl_pct}
              todayComplete={a.today_pl_complete}
              openPl={a.open_pl}
              openPlPct={a.open_pl_pct}
              invested={a.invested}
              cash={a.cash || 0}
            />
            {selected === a.id && detailNode && (
              <div className="col-span-full mt-1">{detailNode}</div>
            )}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  title,
  subtitle,
  amount,
  todayPl,
  todayPlPct,
  todayComplete,
  openPl,
  openPlPct,
  invested,
  cash,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
  amount: string;
  todayPl?: number | null;
  todayPlPct?: number | null;
  /** False when account holds options — today_pl is stocks-only, mark with *. */
  todayComplete?: boolean;
  openPl?: number | null;
  openPlPct?: number | null;
  invested?: number;
  cash?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-stretch gap-1 rounded-xl border p-3 text-left transition-colors ${
        active
          ? "border-(--color-accent) bg-(--color-accent)/10"
          : "border-(--color-border) bg-(--color-panel) hover:border-(--color-text-dim)"
      }`}
    >
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-[10px] uppercase tracking-wide text-(--color-text-dim)">
        {subtitle}
      </div>
      <div className="mt-1 text-base font-semibold tabular-nums">{amount}</div>
      {(todayPl != null || openPl != null) && (
        <div className="mt-0.5 grid grid-cols-2 gap-2 text-[11px] tabular-nums">
          {todayPl != null && (
            <div title={todayComplete === false ? "Stocks only — no option prev-close data" : undefined}>
              <div className="text-[9px] uppercase tracking-wide text-(--color-text-dim)">
                Today{todayComplete === false ? " *" : ""}
              </div>
              <div className={`font-medium ${changeClass(todayPl)}`}>
                {todayPl >= 0 ? "+" : "-"}${fmtPrice(Math.abs(todayPl))}
                {todayPlPct != null && ` (${fmtPct(todayPlPct)})`}
              </div>
            </div>
          )}
          {openPl != null && (
            <div>
              <div className="text-[9px] uppercase tracking-wide text-(--color-text-dim)">
                Open P/L
              </div>
              <div className={`font-medium ${changeClass(openPl)}`}>
                {openPl >= 0 ? "+" : "-"}${fmtPrice(Math.abs(openPl))}
                {openPlPct != null && ` (${fmtPct(openPlPct)})`}
              </div>
            </div>
          )}
        </div>
      )}
      {(invested != null || cash != null) && (
        <div className="mt-1 grid grid-cols-2 gap-2 border-t border-(--color-border)/60 pt-2 text-[11px] tabular-nums">
          <div>
            <div className="text-[9px] uppercase tracking-wide text-(--color-text-dim)">
              Invested
            </div>
            <div className="font-medium">${fmtPrice(invested ?? 0)}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wide text-(--color-text-dim)">
              Cash
            </div>
            <div className="font-medium">${fmtPrice(cash ?? 0)}</div>
          </div>
        </div>
      )}
    </button>
  );
}

function SelectedAccountDetail({
  selectedId,
  holdings,
  auths,
  onDisconnect,
  busy,
}: {
  selectedId: string;
  holdings: SnapTradeHoldings;
  auths: SnapTradeAuthorization[] | null;
  onDisconnect: (id: string) => void;
  busy: boolean;
}) {
  if (selectedId === "all") {
    // Aggregated view: roll all positions/options into one set, top 5 orders, connection list at bottom.
    return (
      <div className="space-y-4">
        <AggregatedDetail holdings={holdings} />
        {auths && auths.length > 0 && (
          <ConnectionList auths={auths} onDisconnect={onDisconnect} busy={busy} />
        )}
      </div>
    );
  }
  const acct = holdings.accounts.find((a) => a.id === selectedId);
  if (!acct) {
    return (
      <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4 text-sm text-(--color-text-dim)">
        Account no longer connected.
      </div>
    );
  }
  return (
    <AccountSection
      account={acct}
      positions={holdings.positions.filter((p) => p.account_id === acct.id)}
      options={holdings.options.filter((o) => o.account_id === acct.id)}
      orders={holdings.orders.filter((o) => o.account_id === acct.id).slice(0, 5)}
    />
  );
}

function AggregatedDetail({ holdings }: { holdings: SnapTradeHoldings }) {
  const positions = holdings.positions;
  const options = holdings.options;
  const orders = holdings.orders.slice(0, 5);
  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel)">
      <header className="border-b border-(--color-border) px-4 py-3">
        <div className="text-base font-semibold">All accounts</div>
        <div className="text-xs text-(--color-text-dim)">
          {holdings.accounts.length} brokerage{holdings.accounts.length === 1 ? "" : "s"} ·
          {" "}
          {positions.length} stock position{positions.length === 1 ? "" : "s"} ·
          {" "}
          {options.length} option{options.length === 1 ? "" : "s"}
        </div>
      </header>
      <div className="space-y-4 p-4">
        {options.length > 0 && <SubOptionsTable options={options} />}
        {positions.length > 0 && <SubPositionsTable positions={positions} />}
        {orders.length > 0 && <SubOrdersTable orders={orders} />}
        {positions.length === 0 && options.length === 0 && (
          <div className="text-sm text-(--color-text-dim)">No positions across any account.</div>
        )}
      </div>
    </div>
  );
}

function ConnectionList({
  auths,
  onDisconnect,
  busy,
}: {
  auths: SnapTradeAuthorization[];
  onDisconnect: (id: string) => void;
  busy: boolean;
}) {
  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-3">
      <h4 className="mb-2 text-xs uppercase tracking-wide text-(--color-text-dim)">
        Connections
      </h4>
      <ul className="divide-y divide-(--color-border)">
        {auths.map((a) => (
          <li
            key={a.id}
            className="flex items-center justify-between py-2 text-sm"
          >
            <div>
              <span className="font-medium">
                {a.brokerage?.name ?? "Brokerage"}
              </span>
              {a.disabled && (
                <span className="ml-2 rounded bg-(--color-down)/20 px-1.5 py-0.5 text-[10px] text-(--color-down)">
                  DISABLED
                </span>
              )}
            </div>
            <button
              onClick={() => onDisconnect(a.id)}
              disabled={busy}
              className="text-(--color-text-dim) hover:text-(--color-down)"
              aria-label={`Disconnect ${a.brokerage?.name}`}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TotalsCard({ totals }: { totals: SnapTradeHoldings["totals"] }) {
  const totalReturnPct =
    totals.cost_basis > 0 ? (totals.unrealized_pl / totals.cost_basis) * 100 : null;
  const cards = [
    {
      label: "Total Equity",
      value: `$${fmtPrice(totals.equity)}`,
      sub: "cash + investments",
    },
    {
      label: "Invested",
      value: `$${fmtPrice(totals.invested)}`,
      sub: totals.cost_basis ? `cost basis $${fmtPrice(totals.cost_basis)}` : "",
    },
    {
      label: "Cash Available",
      value: `$${fmtPrice(totals.cash)}`,
      sub: "",
    },
    {
      label: "Unrealized P&L",
      value:
        `${totals.unrealized_pl >= 0 ? "+" : "-"}$${fmtPrice(Math.abs(totals.unrealized_pl))}` +
        (totalReturnPct != null ? ` (${fmtPct(totalReturnPct)})` : ""),
      tone: "pl" as const,
      sub: "",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-xl border border-(--color-border) bg-(--color-panel) p-3 sm:p-4"
        >
          <div className="text-[10px] uppercase tracking-wide text-(--color-text-dim) sm:text-xs">
            {c.label}
          </div>
          <div
            className={`mt-1 break-words text-base font-semibold tabular-nums sm:text-xl ${
              c.tone === "pl" ? changeClass(totals.unrealized_pl) : ""
            }`}
          >
            {c.value}
          </div>
          {c.sub && (
            <div className="mt-0.5 text-[10px] text-(--color-text-dim) tabular-nums">
              {c.sub}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function AccountSection({
  account,
  positions,
  options,
  orders,
}: {
  account: SnapTradeAccount;
  positions: SnapTradeStock[];
  options: SnapTradeOption[];
  orders: SnapTradeOrder[];
}) {
  const acctCost =
    positions.reduce((s, p) => s + (p.avg_cost ? p.quantity * p.avg_cost : 0), 0) +
    options.reduce(
      (s, o) => s + (o.avg_cost ? o.quantity * (o.avg_cost ?? 0) * 100 : 0),
      0,
    );
  const acctValue =
    positions.reduce((s, p) => s + p.market_value, 0) +
    options.reduce((s, o) => s + o.market_value, 0);
  const acctPL = acctCost ? acctValue - acctCost : 0;
  const acctPLPct = acctCost ? (acctPL / acctCost) * 100 : null;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(account.name);
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setDraft(account.name);
    setEditing(true);
  };
  const cancelEdit = () => setEditing(false);
  const applyRename = (newName: string) => {
    // Optimistic in-place cache update so the panel doesn't blank to skeleton.
    mutateCache<SnapTradeHoldings>("snaptrade:holdings", (h) => {
      if (!h) return null;
      return {
        ...h,
        accounts: h.accounts.map((a) =>
          a.id === account.id
            ? { ...a, name: newName, original_name: a.original_name ?? a.name }
            : a,
        ),
        positions: h.positions.map((p) =>
          p.account_id === account.id ? { ...p, account: newName } : p,
        ),
        options: h.options.map((o) =>
          o.account_id === account.id ? { ...o, account: newName } : o,
        ),
        orders: h.orders.map((o) =>
          o.account_id === account.id ? { ...o, account: newName } : o,
        ),
      };
    });
  };

  const save = async () => {
    const name = draft.trim();
    if (!name || name === account.name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await api.put(`/snaptrade/account/${account.id}/nickname`, { nickname: name });
      applyRename(name);
      setEditing(false);
    } catch (e) {
      console.error("rename failed", e);
    } finally {
      setSaving(false);
    }
  };
  const reset = async () => {
    setSaving(true);
    try {
      await api.delete(`/snaptrade/account/${account.id}/nickname`);
      // Restore original name if we have it.
      mutateCache<SnapTradeHoldings>("snaptrade:holdings", (h) => {
        if (!h) return null;
        const originalName = account.original_name ?? account.name;
        return {
          ...h,
          accounts: h.accounts.map((a) =>
            a.id === account.id
              ? { ...a, name: originalName, original_name: undefined }
              : a,
          ),
          positions: h.positions.map((p) =>
            p.account_id === account.id ? { ...p, account: originalName } : p,
          ),
          options: h.options.map((o) =>
            o.account_id === account.id ? { ...o, account: originalName } : o,
          ),
          orders: h.orders.map((o) =>
            o.account_id === account.id ? { ...o, account: originalName } : o,
          ),
        };
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };
  void clearCacheKey;

  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel)">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-(--color-border) px-4 py-3">
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                  if (e.key === "Escape") cancelEdit();
                }}
                autoFocus
                disabled={saving}
                className="rounded-md border border-(--color-border) bg-(--color-bg) px-2 py-1 text-base font-semibold focus:border-(--color-accent) focus:outline-none"
              />
              <button onClick={save} disabled={saving} className="text-(--color-up)" aria-label="Save">
                <Check size={16} />
              </button>
              <button onClick={cancelEdit} disabled={saving} className="text-(--color-text-dim)" aria-label="Cancel">
                <X size={16} />
              </button>
              {account.original_name && (
                <button
                  onClick={reset}
                  disabled={saving}
                  className="text-[11px] text-(--color-text-dim) underline hover:text-(--color-text)"
                  title="Reset to broker default"
                >
                  reset
                </button>
              )}
            </>
          ) : (
            <>
              <div>
                <div className="text-base font-semibold">{account.name}</div>
                <div className="text-xs text-(--color-text-dim)">
                  {account.broker}
                  {account.type ? ` · ${account.type}` : ""}
                  {account.original_name && (
                    <span className="ml-1 italic">(was {account.original_name})</span>
                  )}
                </div>
              </div>
              <button
                onClick={startEdit}
                className="text-(--color-text-dim) hover:text-(--color-text)"
                aria-label="Rename account"
                title="Rename"
              >
                <Pencil size={12} />
              </button>
            </>
          )}
        </div>
        {acctCost > 0 && (
          <span className={`font-medium tabular-nums ${changeClass(acctPL)}`}>
            {acctPL >= 0 ? "+" : "-"}${fmtPrice(Math.abs(acctPL))}
            {acctPLPct != null && ` (${fmtPct(acctPLPct)})`}
          </span>
        )}
      </header>

      <div className="grid grid-cols-3 gap-2 px-4 pt-3 sm:gap-3">
        <AcctStat
          label="Total Value"
          value={`$${fmtPrice(account.balance)}`}
          sub="cash + investments"
        />
        <AcctStat
          label="Invested"
          value={`$${fmtPrice(acctValue)}`}
          sub={
            acctCost > 0
              ? `cost basis $${fmtPrice(acctCost)}`
              : "—"
          }
        />
        <AcctStat
          label="Cash Available"
          value={`$${fmtPrice(account.cash)}`}
          sub=""
        />
      </div>

      <div className="space-y-4 p-4">
        {options.length > 0 && <SubOptionsTable options={options} />}
        {positions.length > 0 && <SubPositionsTable positions={positions} />}
        {orders.length > 0 && <SubOrdersTable orders={orders} />}
        {positions.length === 0 && options.length === 0 && orders.length === 0 && (
          <div className="text-sm text-(--color-text-dim)">No positions, options, or orders.</div>
        )}
      </div>
    </div>
  );
}

function AcctStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-(--color-border) bg-(--color-panel-2) p-3">
      <div className="text-[10px] uppercase tracking-wide text-(--color-text-dim)">
        {label}
      </div>
      <div className="mt-0.5 text-base font-semibold tabular-nums sm:text-lg">{value}</div>
      {sub && (
        <div className="mt-0.5 text-[10px] text-(--color-text-dim) tabular-nums">
          {sub}
        </div>
      )}
    </div>
  );
}

function SubPositionsTable({ positions }: { positions: SnapTradeStock[] }) {
  return (
    <div>
      <h4 className="mb-2 text-xs uppercase tracking-wide text-(--color-text-dim)">
        Stocks ({positions.length})
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-(--color-text-dim)">
            <tr>
              <th className="text-left font-normal">Symbol</th>
              <th className="text-right font-normal">Qty</th>
              <th className="text-right font-normal">Avg</th>
              <th className="text-right font-normal">Last</th>
              <th className="text-right font-normal">Value</th>
              <th className="text-right font-normal">P&L</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p, i) => (
              <tr key={i} className="border-t border-(--color-border)">
                <td className="py-1 font-medium">
                  {p.ticker ?? "—"}
                  <ErBadge days={p.earnings_days} />
                </td>
                <td className="py-1 text-right tabular-nums">{p.quantity}</td>
                <td className="py-1 text-right tabular-nums">
                  {p.avg_cost ? `$${fmtPrice(p.avg_cost)}` : "—"}
                </td>
                <td className="py-1 text-right tabular-nums">${fmtPrice(p.price)}</td>
                <td className="py-1 text-right tabular-nums">${fmtPrice(p.market_value)}</td>
                <td className={`py-1 text-right tabular-nums ${changeClass(p.unrealized_pl)}`}>
                  {p.unrealized_pl != null
                    ? `${p.unrealized_pl >= 0 ? "+" : "-"}$${fmtPrice(Math.abs(p.unrealized_pl))}`
                    : "—"}
                  {p.unrealized_pl_pct != null && (
                    <div className="text-[10px]">{fmtPct(p.unrealized_pl_pct)}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SubOptionsTable({ options }: { options: SnapTradeOption[] }) {
  const onSelect = useContext(OptionSelectionContext);
  return (
    <div>
      <h4 className="mb-2 text-xs uppercase tracking-wide text-(--color-text-dim)">
        Options ({options.length})
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-(--color-text-dim)">
            <tr>
              <th className="text-left font-normal">Underlying</th>
              <th className="text-left font-normal">Type</th>
              <th className="text-right font-normal">Strike</th>
              <th className="text-left font-normal pl-3">Exp</th>
              <th className="text-right font-normal">Qty</th>
              <th className="text-right font-normal">Avg</th>
              <th className="text-right font-normal">Last</th>
              <th className="text-right font-normal">Value</th>
              <th className="text-right font-normal">P&L</th>
            </tr>
          </thead>
          <tbody>
            {options.map((o, i) => {
              const clickable =
                !!onSelect && !!o.underlying && !!o.expiration && o.strike != null;
              return (
              <tr
                key={i}
                className={`border-t border-(--color-border) ${
                  clickable
                    ? "cursor-pointer hover:bg-(--color-panel-2)"
                    : ""
                }`}
                onClick={clickable ? () => onSelect?.(o) : undefined}
                title={clickable ? "Open projected P/L" : undefined}
              >
                <td className="py-1 font-medium">
                  {o.underlying ?? "—"}
                  <ErBadge days={o.earnings_days} />
                </td>
                <td className="py-1 capitalize">{o.option_type?.toLowerCase() ?? "—"}</td>
                <td className="py-1 text-right tabular-nums">
                  {o.strike != null ? `$${o.strike}` : "—"}
                </td>
                <td className="py-1 pl-3 text-xs tabular-nums">{o.expiration ?? "—"}</td>
                <td className="py-1 text-right tabular-nums">{o.quantity}</td>
                <td className="py-1 text-right tabular-nums">
                  {o.avg_cost ? `$${fmtPrice(o.avg_cost)}` : "—"}
                </td>
                <td className="py-1 text-right tabular-nums">${fmtPrice(o.price)}</td>
                <td className="py-1 text-right tabular-nums">${fmtPrice(o.market_value)}</td>
                <td className={`py-1 text-right tabular-nums ${changeClass(o.unrealized_pl)}`}>
                  {o.unrealized_pl != null
                    ? `${o.unrealized_pl >= 0 ? "+" : "-"}$${fmtPrice(Math.abs(o.unrealized_pl))}`
                    : "—"}
                  {o.unrealized_pl_pct != null && (
                    <div className="text-[10px]">{fmtPct(o.unrealized_pl_pct)}</div>
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SubOrdersTable({ orders }: { orders: SnapTradeOrder[] }) {
  return (
    <div>
      <h4 className="mb-2 text-xs uppercase tracking-wide text-(--color-text-dim)">
        Recent orders ({orders.length})
      </h4>
      <div className="max-h-56 overflow-auto">
        <table className="w-full text-xs">
          <thead className="text-(--color-text-dim)">
            <tr>
              <th className="text-left font-normal">Time</th>
              <th className="text-left font-normal">Symbol</th>
              <th className="text-left font-normal">Action</th>
              <th className="text-right font-normal">Qty</th>
              <th className="text-right font-normal">Price</th>
              <th className="text-right font-normal pr-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o, i) => (
              <tr key={i} className="border-t border-(--color-border)">
                <td className="py-1 text-(--color-text-dim) tabular-nums">{fmtTime(o.time)}</td>
                <td className="py-1 font-medium">{describeOrder(o)}</td>
                <td className="py-1 uppercase text-(--color-text-dim)">{o.action ?? "—"}</td>
                <td className="py-1 text-right tabular-nums">{fmtQty(o.total_quantity)}</td>
                <td className="py-1 text-right tabular-nums">
                  {o.execution_price != null ? `$${fmtPrice(o.execution_price)}` : "—"}
                </td>
                <td className="py-1 pr-2 text-right">
                  <span
                    className={`rounded px-1.5 py-0.5 ${STATUS_COLOR[o.status ?? ""] ?? "bg-(--color-panel-2)"}`}
                  >
                    {o.status ?? "—"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  EXECUTED: "bg-(--color-up)/20 text-(--color-up)",
  CANCELED: "bg-(--color-text-dim)/20 text-(--color-text-dim)",
  PARTIAL: "bg-yellow-500/20 text-yellow-200",
  PENDING: "bg-blue-500/20 text-blue-200",
  REJECTED: "bg-(--color-down)/20 text-(--color-down)",
};

function fmtTime(t: string | null): string {
  if (!t) return "—";
  try {
    const d = new Date(t);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return t;
  }
}

function fmtQty(n: number | null): string {
  if (n == null) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function describeOrder(o: SnapTradeHoldings["orders"][number]): string {
  if (!o.ticker) return "—";
  if (o.is_option && o.strike != null && o.expiration && o.option_type) {
    const t = o.option_type.toLowerCase().startsWith("c") ? "C" : "P";
    return `${o.ticker} $${o.strike}${t} ${o.expiration}`;
  }
  return o.ticker;
}

// Legacy merged-tables components removed; per-account SubOrdersTable inside AccountSection
// now renders these. STATUS_COLOR / fmtTime / fmtQty / describeOrder above remain in use.
