import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { api, ApiError } from "../api/client";
import type {
  AccountSummary,
  AlpacaOrder,
  AlpacaPosition,
  ManualPosition,
} from "../api/types";
import { changeClass, fmtPct, fmtPrice } from "../lib/format";
import { Skeleton } from "./Skeleton";

const REFRESH_MS = 60_000;

const STATUS_COLOR: Record<string, string> = {
  filled: "bg-(--color-up)/20 text-(--color-up)",
  partially_filled: "bg-yellow-500/20 text-yellow-200",
  canceled: "bg-(--color-text-dim)/20 text-(--color-text-dim)",
  pending_new: "bg-blue-500/20 text-blue-200",
  new: "bg-blue-500/20 text-blue-200",
  rejected: "bg-(--color-down)/20 text-(--color-down)",
};

export function Positions({ refreshNonce }: { refreshNonce: number }) {
  const [acct, setAcct] = useState<AccountSummary | null>(null);
  const [alpaca, setAlpaca] = useState<AlpacaPosition[] | null>(null);
  const [orders, setOrders] = useState<AlpacaOrder[] | null>(null);
  const [manual, setManual] = useState<ManualPosition[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [needsCfg, setNeedsCfg] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, p, o, m] = await Promise.all([
        api.get<AccountSummary>("/positions/account").catch((e) => {
          if (e instanceof ApiError && e.status === 400) {
            setNeedsCfg(true);
            return null;
          }
          throw e;
        }),
        api
          .get<{ positions: AlpacaPosition[] }>("/positions/alpaca")
          .then((r) => r.positions)
          .catch(() => []),
        api
          .get<{ orders: AlpacaOrder[] }>("/positions/orders")
          .then((r) => r.orders)
          .catch(() => []),
        api.get<ManualPosition[]>("/positions/manual"),
      ]);
      setAcct(a);
      setAlpaca(p);
      setOrders(o);
      setManual(m);
      setErr(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e.detail : (e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load, refreshNonce]);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-(--color-text-dim)">Positions</h2>
      {err && (
        <div className="rounded-md border border-(--color-down)/40 bg-(--color-panel) p-2 text-xs text-(--color-down)">
          {err}
        </div>
      )}

      {needsCfg ? (
        <div className="rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-200">
          Alpaca not configured — add paper API keys to see account / positions / orders.
        </div>
      ) : (
        <AccountCards acct={acct} />
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <AlpacaPositionsCard rows={alpaca} />
        <RecentOrdersCard rows={orders} />
      </div>

      <ManualPositionsCard rows={manual} onChange={load} />
    </section>
  );
}

function AccountCards({ acct }: { acct: AccountSummary | null }) {
  if (!acct) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }
  const cards: { label: string; value: string; tone?: "pl" }[] = [
    { label: "Equity", value: `$${fmtPrice(acct.equity)}` },
    {
      label: "Today's P&L",
      value: `${acct.today_pl >= 0 ? "+" : "-"}$${fmtPrice(Math.abs(acct.today_pl))} (${fmtPct(acct.today_pl_pct)})`,
      tone: "pl",
    },
    { label: "Cash", value: `$${fmtPrice(acct.cash)}` },
    { label: "Buying power", value: `$${fmtPrice(acct.buying_power)}` },
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
              c.tone === "pl" ? changeClass(acct.today_pl) : ""
            }`}
          >
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function AlpacaPositionsCard({ rows }: { rows: AlpacaPosition[] | null }) {
  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
      <h3 className="mb-3 text-xs uppercase tracking-wide text-(--color-text-dim)">
        Alpaca positions
      </h3>
      {!rows ? (
        <Skeleton className="h-32 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-(--color-text-dim)">No open positions.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-(--color-text-dim)">
            <tr>
              <th className="text-left font-normal">Symbol</th>
              <th className="text-right font-normal">Qty</th>
              <th className="text-right font-normal">Avg</th>
              <th className="text-right font-normal">Last</th>
              <th className="text-right font-normal">P&L</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.symbol} className="border-t border-(--color-border)">
                <td className="py-1 font-medium">{p.symbol}</td>
                <td className="py-1 text-right tabular-nums">{p.qty}</td>
                <td className="py-1 text-right tabular-nums">
                  ${fmtPrice(p.avg_entry_price)}
                </td>
                <td className="py-1 text-right tabular-nums">
                  ${fmtPrice(p.current_price)}
                </td>
                <td
                  className={`py-1 text-right tabular-nums ${changeClass(p.unrealized_pl)}`}
                >
                  {p.unrealized_pl >= 0 ? "+" : "-"}$
                  {fmtPrice(Math.abs(p.unrealized_pl))}
                  <div className="text-[10px]">{fmtPct(p.unrealized_plpc)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function RecentOrdersCard({ rows }: { rows: AlpacaOrder[] | null }) {
  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
      <h3 className="mb-3 text-xs uppercase tracking-wide text-(--color-text-dim)">
        Recent orders
      </h3>
      {!rows ? (
        <Skeleton className="h-32 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-(--color-text-dim)">No recent orders.</p>
      ) : (
        <ul className="max-h-64 space-y-2 overflow-auto">
          {rows.map((o) => (
            <li key={o.id} className="flex items-center justify-between text-xs">
              <div>
                <span className="font-medium">{o.symbol}</span>{" "}
                <span className="uppercase text-(--color-text-dim)">{o.side}</span>{" "}
                <span className="tabular-nums">{o.qty}</span>{" "}
                <span className="text-(--color-text-dim)">{o.type}</span>
              </div>
              <span
                className={`rounded px-1.5 py-0.5 ${STATUS_COLOR[o.status] ?? "bg-(--color-panel-2)"}`}
              >
                {o.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ManualPositionsCard({
  rows,
  onChange,
}: {
  rows: ManualPosition[] | null;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [symbol, setSymbol] = useState("");
  const [type, setType] = useState<"stock" | "call" | "put">("stock");
  const [entry, setEntry] = useState("");
  const [qty, setQty] = useState("");
  const [strike, setStrike] = useState("");
  const [exp, setExp] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post("/positions/manual", {
        symbol: symbol.trim().toUpperCase(),
        position_type: type,
        entry_price: Number(entry),
        quantity: Number(qty),
        strike: strike ? Number(strike) : null,
        expiration: exp || null,
        notes: notes || null,
      });
      setSymbol("");
      setEntry("");
      setQty("");
      setStrike("");
      setExp("");
      setNotes("");
      setOpen(false);
      onChange();
    } catch (e) {
      setErr(e instanceof ApiError ? e.detail : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    setBusy(true);
    try {
      await api.delete(`/positions/manual/${id}`);
      onChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-wide text-(--color-text-dim)">
          Manual positions
        </h3>
        <button
          onClick={() => setOpen((o) => !o)}
          className="rounded-md border border-(--color-border) px-2 py-1 text-xs hover:bg-(--color-panel-2)"
        >
          {open ? "Cancel" : "+ Add"}
        </button>
      </div>

      {open && (
        <form onSubmit={submit} className="mb-3 grid grid-cols-2 gap-2 text-xs">
          <input
            placeholder="Symbol"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            required
            className="rounded-md border border-(--color-border) bg-(--color-bg) px-2 py-1 uppercase"
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value as "stock" | "call" | "put")}
            className="rounded-md border border-(--color-border) bg-(--color-bg) px-2 py-1"
          >
            <option value="stock">Stock</option>
            <option value="call">Call</option>
            <option value="put">Put</option>
          </select>
          <input
            type="number"
            step="0.01"
            placeholder="Entry price"
            value={entry}
            onChange={(e) => setEntry(e.target.value)}
            required
            className="rounded-md border border-(--color-border) bg-(--color-bg) px-2 py-1"
          />
          <input
            type="number"
            step="any"
            placeholder="Quantity"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            required
            className="rounded-md border border-(--color-border) bg-(--color-bg) px-2 py-1"
          />
          {type !== "stock" && (
            <>
              <input
                type="number"
                step="0.01"
                placeholder="Strike"
                value={strike}
                onChange={(e) => setStrike(e.target.value)}
                className="rounded-md border border-(--color-border) bg-(--color-bg) px-2 py-1"
              />
              <input
                type="date"
                value={exp}
                onChange={(e) => setExp(e.target.value)}
                className="rounded-md border border-(--color-border) bg-(--color-bg) px-2 py-1"
              />
            </>
          )}
          <input
            placeholder="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="col-span-2 rounded-md border border-(--color-border) bg-(--color-bg) px-2 py-1"
          />
          {err && <div className="col-span-2 text-(--color-down)">{err}</div>}
          <button
            type="submit"
            disabled={busy}
            className="col-span-2 rounded-md bg-(--color-accent) px-2 py-1 font-medium text-white disabled:opacity-50"
          >
            Add position
          </button>
        </form>
      )}

      {!rows ? (
        <Skeleton className="h-16 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-(--color-text-dim)">
          No manual positions tracked.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-(--color-text-dim)">
            <tr>
              <th className="text-left font-normal">Symbol</th>
              <th className="text-left font-normal">Type</th>
              <th className="text-right font-normal">Qty</th>
              <th className="text-right font-normal">Entry</th>
              <th className="text-right font-normal">Last</th>
              <th className="text-right font-normal">P&L</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className="border-t border-(--color-border)">
                <td className="py-1 font-medium">
                  {m.symbol}
                  {m.position_type !== "stock" && m.strike && (
                    <span className="ml-1 text-[10px] text-(--color-text-dim)">
                      {m.strike}
                      {m.position_type[0].toUpperCase()} {m.expiration}
                    </span>
                  )}
                </td>
                <td className="py-1 capitalize">{m.position_type}</td>
                <td className="py-1 text-right tabular-nums">{m.quantity}</td>
                <td className="py-1 text-right tabular-nums">
                  ${fmtPrice(m.entry_price)}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {m.last_price != null ? `$${fmtPrice(m.last_price)}` : "—"}
                </td>
                <td
                  className={`py-1 text-right tabular-nums ${changeClass(m.pl)}`}
                >
                  {m.pl != null
                    ? `${m.pl >= 0 ? "+" : "-"}$${fmtPrice(Math.abs(m.pl))}`
                    : "—"}
                  {m.pl_pct != null && (
                    <div className="text-[10px]">{fmtPct(m.pl_pct)}</div>
                  )}
                </td>
                <td className="py-1 text-right">
                  <button
                    onClick={() => remove(m.id)}
                    disabled={busy}
                    className="text-(--color-text-dim) hover:text-(--color-down)"
                  >
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
