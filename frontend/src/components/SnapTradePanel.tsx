import { useCallback, useEffect, useState } from "react";
import { ExternalLink, ListPlus, RefreshCcw, Trash2 } from "lucide-react";
import { api, ApiError } from "../api/client";
import type {
  SnapTradeAuthorization,
  SnapTradeHoldings,
} from "../api/types";
import { changeClass, fmtPct, fmtPrice } from "../lib/format";
import { Skeleton } from "./Skeleton";

const REFRESH_MS = 5 * 60_000;

export function SnapTradePanel({ refreshNonce }: { refreshNonce: number }) {
  const [auths, setAuths] = useState<SnapTradeAuthorization[] | null>(null);
  const [holdings, setHoldings] = useState<SnapTradeHoldings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [needsCfg, setNeedsCfg] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, h] = await Promise.all([
        api.get<{ authorizations: SnapTradeAuthorization[] }>(
          "/snaptrade/authorizations",
        ),
        api.get<SnapTradeHoldings>("/snaptrade/holdings"),
      ]);
      setAuths(a.authorizations);
      setHoldings(h);
      setErr(null);
      setNeedsCfg(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) {
        setNeedsCfg(true);
        setAuths([]);
        setHoldings(null);
      } else {
        setErr(e instanceof ApiError ? e.detail : (e as Error).message);
      }
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load, refreshNonce]);

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

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-(--color-text-dim)">
          Brokerages (via SnapTrade)
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={syncToWatchlist}
            disabled={busy || needsCfg || (auths?.length ?? 0) === 0}
            title="Add every stock + option underlying you hold to the watchlist"
            className="flex items-center gap-1 rounded-md border border-(--color-border) px-2 py-1 text-xs hover:bg-(--color-panel-2) disabled:opacity-50"
          >
            <ListPlus size={12} /> Sync to watchlist
          </button>
          <button
            onClick={load}
            disabled={busy}
            className="flex items-center gap-1 rounded-md border border-(--color-border) px-2 py-1 text-xs text-(--color-text-dim) hover:text-(--color-text)"
            aria-label="Refresh"
          >
            <RefreshCcw size={12} /> Refresh
          </button>
          <button
            onClick={connect}
            disabled={busy || needsCfg}
            className="flex items-center gap-1 rounded-md bg-(--color-accent) px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            <ExternalLink size={12} /> Connect broker
          </button>
        </div>
      </div>

      {syncMsg && (
        <div className="rounded-md border border-(--color-up)/40 bg-(--color-panel-2) p-2 text-xs text-(--color-up)">
          {syncMsg}
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
          {auths === null ? (
            <Skeleton className="h-20" />
          ) : auths.length === 0 ? (
            <div className="rounded-xl border border-dashed border-(--color-border) bg-(--color-panel) p-6 text-center text-sm text-(--color-text-dim)">
              No brokerages connected. Click "Connect broker" — a SnapTrade
              window opens; pick Robinhood, Schwab, etc., authorize, and come
              back here.
            </div>
          ) : (
            <>
              <ConnectionList auths={auths} onDisconnect={disconnect} busy={busy} />
              {holdings && <TotalsCard totals={holdings.totals} />}
              {holdings && holdings.accounts.length > 0 && (
                <AccountsCard accounts={holdings.accounts} />
              )}
              {holdings && (
                <PositionsTable positions={holdings.positions} />
              )}
              {holdings && holdings.options.length > 0 && (
                <OptionsTable options={holdings.options} />
              )}
              {holdings && holdings.orders.length > 0 && (
                <RecentOrdersTable orders={holdings.orders} />
              )}
            </>
          )}
        </>
      )}
    </section>
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
    totals.cost_basis > 0
      ? (totals.unrealized_pl / totals.cost_basis) * 100
      : null;
  const cards = [
    { label: "Total equity", value: `$${fmtPrice(totals.equity)}` },
    { label: "Cash", value: `$${fmtPrice(totals.cash)}` },
    { label: "Cost basis", value: totals.cost_basis ? `$${fmtPrice(totals.cost_basis)}` : "—" },
    {
      label: "Unrealized P&L",
      value:
        `${totals.unrealized_pl >= 0 ? "+" : "-"}$${fmtPrice(Math.abs(totals.unrealized_pl))}` +
        (totalReturnPct != null ? ` (${fmtPct(totalReturnPct)})` : ""),
      tone: "pl" as const,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4"
        >
          <div className="text-xs uppercase tracking-wide text-(--color-text-dim)">
            {c.label}
          </div>
          <div
            className={`mt-1 text-xl font-semibold tabular-nums ${
              c.tone === "pl" ? changeClass(totals.unrealized_pl) : ""
            }`}
          >
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function AccountsCard({
  accounts,
}: {
  accounts: SnapTradeHoldings["accounts"];
}) {
  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
      <h3 className="mb-2 text-xs uppercase tracking-wide text-(--color-text-dim)">
        Accounts
      </h3>
      <ul className="space-y-1 text-sm">
        {accounts.map((a) => (
          <li key={a.id} className="flex items-center justify-between">
            <span>
              <span className="font-medium">{a.name}</span>{" "}
              <span className="text-xs text-(--color-text-dim)">
                {a.broker}
                {a.type ? ` · ${a.type}` : ""}
              </span>
            </span>
            <span className="text-xs tabular-nums text-(--color-text-dim)">
              ${fmtPrice(a.balance)} (cash ${fmtPrice(a.cash)})
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PositionsTable({
  positions,
}: {
  positions: SnapTradeHoldings["positions"];
}) {
  if (positions.length === 0) return null;
  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
      <h3 className="mb-2 text-xs uppercase tracking-wide text-(--color-text-dim)">
        Stock positions
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-(--color-text-dim)">
            <tr>
              <th className="text-left font-normal">Symbol</th>
              <th className="text-left font-normal">Account</th>
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
                <td className="py-1 font-medium">{p.ticker ?? "—"}</td>
                <td className="py-1 text-xs text-(--color-text-dim)">
                  {p.broker}
                </td>
                <td className="py-1 text-right tabular-nums">{p.quantity}</td>
                <td className="py-1 text-right tabular-nums">
                  {p.avg_cost ? `$${fmtPrice(p.avg_cost)}` : "—"}
                </td>
                <td className="py-1 text-right tabular-nums">
                  ${fmtPrice(p.price)}
                </td>
                <td className="py-1 text-right tabular-nums">
                  ${fmtPrice(p.market_value)}
                </td>
                <td
                  className={`py-1 text-right tabular-nums ${changeClass(p.unrealized_pl)}`}
                >
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

function OptionsTable({
  options,
}: {
  options: SnapTradeHoldings["options"];
}) {
  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
      <h3 className="mb-2 text-xs uppercase tracking-wide text-(--color-text-dim)">
        Options positions
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-(--color-text-dim)">
            <tr>
              <th className="text-left font-normal">Underlying</th>
              <th className="text-left font-normal">Type</th>
              <th className="text-right font-normal">Strike</th>
              <th className="text-left font-normal pl-3">Exp</th>
              <th className="text-left font-normal">Account</th>
              <th className="text-right font-normal">Qty</th>
              <th className="text-right font-normal">Avg</th>
              <th className="text-right font-normal">Last</th>
              <th className="text-right font-normal">Value</th>
              <th className="text-right font-normal">P&L</th>
            </tr>
          </thead>
          <tbody>
            {options.map((o, i) => (
              <tr key={i} className="border-t border-(--color-border)">
                <td className="py-1 font-medium">{o.underlying ?? "—"}</td>
                <td className="py-1 capitalize">{o.option_type?.toLowerCase() ?? "—"}</td>
                <td className="py-1 text-right tabular-nums">
                  {o.strike != null ? `$${o.strike}` : "—"}
                </td>
                <td className="py-1 pl-3 text-xs tabular-nums">{o.expiration ?? "—"}</td>
                <td className="py-1 text-xs text-(--color-text-dim)">
                  {o.broker}
                </td>
                <td className="py-1 text-right tabular-nums">{o.quantity}</td>
                <td className="py-1 text-right tabular-nums">
                  {o.avg_cost ? `$${fmtPrice(o.avg_cost)}` : "—"}
                </td>
                <td className="py-1 text-right tabular-nums">
                  ${fmtPrice(o.price)}
                </td>
                <td className="py-1 text-right tabular-nums">
                  ${fmtPrice(o.market_value)}
                </td>
                <td
                  className={`py-1 text-right tabular-nums ${changeClass(o.unrealized_pl)}`}
                >
                  {o.unrealized_pl != null
                    ? `${o.unrealized_pl >= 0 ? "+" : "-"}$${fmtPrice(Math.abs(o.unrealized_pl))}`
                    : "—"}
                  {o.unrealized_pl_pct != null && (
                    <div className="text-[10px]">{fmtPct(o.unrealized_pl_pct)}</div>
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

function RecentOrdersTable({
  orders,
}: {
  orders: SnapTradeHoldings["orders"];
}) {
  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
      <h3 className="mb-2 text-xs uppercase tracking-wide text-(--color-text-dim)">
        Recent broker orders
      </h3>
      <div className="max-h-72 overflow-auto">
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
                <td className="py-1 text-(--color-text-dim) tabular-nums">
                  {fmtTime(o.time)}
                </td>
                <td className="py-1 font-medium">{describeOrder(o)}</td>
                <td className="py-1 uppercase text-(--color-text-dim)">
                  {o.action ?? "—"}
                </td>
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
