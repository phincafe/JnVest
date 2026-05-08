import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { usePlaidLink } from "react-plaid-link";
import { api, ApiError } from "../api/client";
import type {
  PlaidHoldingsResponse,
  PlaidItem,
  PlaidItemHoldings,
} from "../api/types";
import { changeClass, fmtPct, fmtPrice } from "../lib/format";
import { Skeleton } from "./Skeleton";

export function PlaidPanel({ refreshNonce }: { refreshNonce: number }) {
  const [items, setItems] = useState<PlaidItem[] | null>(null);
  const [holdings, setHoldings] = useState<PlaidHoldingsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [needsCfg, setNeedsCfg] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [i, h] = await Promise.all([
        api.get<PlaidItem[]>("/plaid/items"),
        api.get<PlaidHoldingsResponse>("/plaid/holdings"),
      ]);
      setItems(i);
      setHoldings(h);
      setErr(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e.detail : (e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshNonce]);

  const removeItem = async (id: number) => {
    setBusy(true);
    try {
      await api.delete(`/plaid/items/${id}`);
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-(--color-text-dim)">
          Brokerages (via Plaid)
        </h2>
        <ConnectButton
          onConnected={load}
          onMissingCfg={() => setNeedsCfg(true)}
          onError={(m) => setErr(m)}
        />
      </div>

      {needsCfg && (
        <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-2 text-xs text-yellow-200">
          Plaid not configured — add <code>PLAID_CLIENT_ID</code> and{" "}
          <code>PLAID_SECRET</code> to <code>.env</code>. Get free Sandbox keys at{" "}
          <a className="underline" href="https://dashboard.plaid.com" target="_blank" rel="noopener noreferrer">
            dashboard.plaid.com
          </a>
          .
        </div>
      )}

      {err && (
        <div className="rounded-md border border-(--color-down)/40 bg-(--color-panel) p-2 text-xs text-(--color-down)">
          {err}
        </div>
      )}

      {items === null ? (
        <Skeleton className="h-16" />
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-(--color-border) bg-(--color-panel) p-6 text-center text-sm text-(--color-text-dim)">
          No brokerages connected yet. Click "Connect broker" to link Robinhood, Schwab/ToS, Fidelity, etc.
        </div>
      ) : (
        <>
          {holdings && holdings.items.length > 0 && (
            <TotalsCard totals={holdings.totals} />
          )}
          <div className="space-y-3">
            {(holdings?.items ?? []).map((it) => (
              <InstitutionCard
                key={it.id}
                it={it}
                onRemove={() => removeItem(it.id)}
                busy={busy}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function ConnectButton({
  onConnected,
  onMissingCfg,
  onError,
}: {
  onConnected: () => void;
  onMissingCfg: () => void;
  onError: (msg: string) => void;
}) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchLinkToken = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<{ link_token: string }>("/plaid/link-token");
      setLinkToken(r.link_token);
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) onMissingCfg();
      else onError(e instanceof ApiError ? e.detail : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [onMissingCfg, onError]);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (public_token, metadata) => {
      try {
        await api.post("/plaid/exchange", {
          public_token,
          institution_id: metadata.institution?.institution_id ?? null,
          institution_name: metadata.institution?.name ?? null,
        });
        setLinkToken(null);
        onConnected();
      } catch (e) {
        onError(e instanceof ApiError ? e.detail : (e as Error).message);
      }
    },
    onExit: (err) => {
      if (err) onError(err.display_message ?? err.error_message ?? "Plaid Link cancelled");
      setLinkToken(null);
    },
  });

  // Auto-open Plaid Link as soon as a token is fetched and the SDK is ready.
  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  return (
    <button
      onClick={fetchLinkToken}
      disabled={loading}
      className="rounded-md bg-(--color-accent) px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
    >
      {loading ? "Loading…" : "Connect broker"}
    </button>
  );
}

function TotalsCard({ totals }: { totals: PlaidHoldingsResponse["totals"] }) {
  const cards = [
    { label: "Market value", value: `$${fmtPrice(totals.market_value)}` },
    {
      label: "Cost basis",
      value: totals.cost_basis ? `$${fmtPrice(totals.cost_basis)}` : "—",
    },
    {
      label: "Unrealized P&L",
      value:
        totals.unrealized_pl != null
          ? `${totals.unrealized_pl >= 0 ? "+" : "-"}$${fmtPrice(Math.abs(totals.unrealized_pl))}`
          : "—",
      tone: "pl" as const,
    },
    {
      label: "Return",
      value: totals.unrealized_pl_pct != null ? fmtPct(totals.unrealized_pl_pct) : "—",
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

function InstitutionCard({
  it,
  onRemove,
  busy,
}: {
  it: PlaidItemHoldings;
  onRemove: () => void;
  busy: boolean;
}) {
  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">
            {it.institution_name ?? "Connected institution"}
          </div>
          {it.accounts.length > 0 && (
            <div className="text-xs text-(--color-text-dim)">
              {it.accounts
                .map(
                  (a) =>
                    `${a.name ?? "Account"}${a.subtype ? ` (${a.subtype})` : ""}`,
                )
                .join(" · ")}
            </div>
          )}
        </div>
        <button
          onClick={onRemove}
          disabled={busy}
          className="text-(--color-text-dim) hover:text-(--color-down)"
          aria-label="Disconnect"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {it.error ? (
        <div className="text-xs text-(--color-down)">{it.error}</div>
      ) : it.holdings.length === 0 ? (
        <div className="text-xs text-(--color-text-dim)">No holdings reported.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-(--color-text-dim)">
              <tr>
                <th className="text-left font-normal">Symbol</th>
                <th className="text-left font-normal">Account</th>
                <th className="text-right font-normal">Qty</th>
                <th className="text-right font-normal">Price</th>
                <th className="text-right font-normal">Value</th>
                <th className="text-right font-normal">P&L</th>
              </tr>
            </thead>
            <tbody>
              {it.holdings.map((h, i) => (
                <tr key={i} className="border-t border-(--color-border)">
                  <td className="py-1 font-medium">
                    {h.ticker ?? h.name ?? "—"}
                    {h.type && (
                      <span className="ml-1 text-[10px] text-(--color-text-dim)">
                        {h.type}
                      </span>
                    )}
                  </td>
                  <td className="py-1 text-xs text-(--color-text-dim)">
                    {h.account_subtype ?? h.account_name ?? "—"}
                  </td>
                  <td className="py-1 text-right tabular-nums">{h.quantity}</td>
                  <td className="py-1 text-right tabular-nums">${fmtPrice(h.price)}</td>
                  <td className="py-1 text-right tabular-nums">
                    ${fmtPrice(h.market_value)}
                  </td>
                  <td
                    className={`py-1 text-right tabular-nums ${changeClass(h.unrealized_pl)}`}
                  >
                    {h.unrealized_pl != null
                      ? `${h.unrealized_pl >= 0 ? "+" : "-"}$${fmtPrice(Math.abs(h.unrealized_pl))}`
                      : "—"}
                    {h.unrealized_pl_pct != null && (
                      <div className="text-[10px]">{fmtPct(h.unrealized_pl_pct)}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
