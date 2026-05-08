import { useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";

type Side = "buy" | "sell";
type OrderType = "market" | "limit";
type TIF = "day" | "gtc";

type Props = {
  isPaper: boolean;
  onSubmitted: () => void;
};

export function OrderTicket({ isPaper, onSubmitted }: Props) {
  const [symbol, setSymbol] = useState("");
  const [side, setSide] = useState<Side>("buy");
  const [qty, setQty] = useState("");
  const [type, setType] = useState<OrderType>("market");
  const [tif, setTif] = useState<TIF>("day");
  const [limit, setLimit] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!isPaper) {
    return (
      <section className="rounded-xl border border-(--color-down)/40 bg-(--color-panel) p-4">
        <h3 className="text-sm font-medium text-(--color-down)">Order ticket disabled</h3>
        <p className="mt-1 text-sm text-(--color-text-dim)">
          ALPACA_BASE_URL is not paper. Trading from this dashboard is gated to paper only in v1.
          Switch back to <code>https://paper-api.alpaca.markets</code> to enable.
        </p>
      </section>
    );
  }

  const onPreview = (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setConfirming(true);
  };

  const onConfirm = async () => {
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = {
        symbol: symbol.trim().toUpperCase(),
        side,
        qty: Number(qty),
        type,
        time_in_force: tif,
      };
      if (type === "limit") body.limit_price = Number(limit);
      const r = await api.post<{ id: string; status: string }>("/orders", body);
      setMsg(`Submitted: ${r.id?.slice(0, 8) ?? "ok"} (${r.status})`);
      setConfirming(false);
      setSymbol("");
      setQty("");
      setLimit("");
      onSubmitted();
    } catch (e) {
      setErr(e instanceof ApiError ? e.detail : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-(--color-text-dim)">
          Order ticket{" "}
          <span className="ml-2 rounded bg-yellow-600/30 px-1.5 py-0.5 text-[10px] text-yellow-200">
            PAPER
          </span>
        </h3>
      </div>

      <form
        onSubmit={onPreview}
        className="grid grid-cols-2 gap-2 text-sm md:grid-cols-6"
      >
        <input
          placeholder="Symbol"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          required
          className="col-span-2 rounded-md border border-(--color-border) bg-(--color-bg) px-2 py-1.5 uppercase"
        />
        <select
          value={side}
          onChange={(e) => setSide(e.target.value as Side)}
          className="rounded-md border border-(--color-border) bg-(--color-bg) px-2 py-1.5"
        >
          <option value="buy">Buy</option>
          <option value="sell">Sell</option>
        </select>
        <input
          type="number"
          step="any"
          placeholder="Qty"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          required
          className="rounded-md border border-(--color-border) bg-(--color-bg) px-2 py-1.5"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as OrderType)}
          className="rounded-md border border-(--color-border) bg-(--color-bg) px-2 py-1.5"
        >
          <option value="market">Market</option>
          <option value="limit">Limit</option>
        </select>
        <select
          value={tif}
          onChange={(e) => setTif(e.target.value as TIF)}
          className="rounded-md border border-(--color-border) bg-(--color-bg) px-2 py-1.5"
        >
          <option value="day">DAY</option>
          <option value="gtc">GTC</option>
        </select>
        {type === "limit" && (
          <input
            type="number"
            step="0.01"
            placeholder="Limit price"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            required
            className="col-span-2 rounded-md border border-(--color-border) bg-(--color-bg) px-2 py-1.5"
          />
        )}
        <button
          type="submit"
          className="col-span-2 rounded-md bg-(--color-accent) px-3 py-1.5 font-medium text-white disabled:opacity-50 md:col-span-6"
        >
          Preview order
        </button>
      </form>

      {msg && <div className="mt-2 text-xs text-(--color-up)">{msg}</div>}
      {err && <div className="mt-2 text-xs text-(--color-down)">{err}</div>}

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-(--color-border) bg-(--color-panel) p-5">
            <h4 className="text-base font-semibold">Confirm paper order</h4>
            <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-(--color-text-dim)">Symbol</dt>
              <dd className="text-right font-medium">{symbol.toUpperCase()}</dd>
              <dt className="text-(--color-text-dim)">Side</dt>
              <dd className="text-right capitalize">{side}</dd>
              <dt className="text-(--color-text-dim)">Quantity</dt>
              <dd className="text-right tabular-nums">{qty}</dd>
              <dt className="text-(--color-text-dim)">Type</dt>
              <dd className="text-right capitalize">{type}</dd>
              <dt className="text-(--color-text-dim)">TIF</dt>
              <dd className="text-right uppercase">{tif}</dd>
              {type === "limit" && (
                <>
                  <dt className="text-(--color-text-dim)">Limit price</dt>
                  <dd className="text-right tabular-nums">${limit}</dd>
                </>
              )}
            </dl>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirming(false)}
                className="rounded-md border border-(--color-border) px-3 py-1.5 text-sm"
                disabled={busy}
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                disabled={busy}
                className="rounded-md bg-(--color-accent) px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy ? "Submitting…" : "Submit paper order"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
