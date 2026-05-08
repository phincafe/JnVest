import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { InsiderResponse } from "../api/types";
import { changeClass, fmtPrice } from "../lib/format";
import { Skeleton } from "./Skeleton";

export function InsiderPanel({ symbol }: { symbol: string }) {
  const [data, setData] = useState<InsiderResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setErr(null);
    api
      .get<InsiderResponse>(`/stock/${symbol}/insider`)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof ApiError ? e.detail : (e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
      <h3 className="mb-3 text-sm font-medium text-(--color-text-dim)">
        Insider trading (last 90d)
      </h3>
      {err ? (
        <p className="text-sm text-(--color-down)">{err}</p>
      ) : !data ? (
        <Skeleton className="h-32" />
      ) : data.warning ? (
        <p className="text-xs text-(--color-text-dim)">{data.warning}</p>
      ) : !data.summary || data.items.length === 0 ? (
        <p className="text-sm text-(--color-text-dim)">No insider trades reported.</p>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-3 gap-2 text-xs">
            <Stat
              label="Buys"
              value={`${Math.round(data.summary.buy_shares).toLocaleString()} sh`}
              sub={`$${fmtPrice(data.summary.buy_value)}`}
              tone="text-(--color-up)"
            />
            <Stat
              label="Sells"
              value={`${Math.round(data.summary.sell_shares).toLocaleString()} sh`}
              sub={`$${fmtPrice(data.summary.sell_value)}`}
              tone="text-(--color-down)"
            />
            <Stat
              label="Net"
              value={
                (data.summary.net_shares >= 0 ? "+" : "") +
                Math.round(data.summary.net_shares).toLocaleString() +
                " sh"
              }
              sub=""
              tone={changeClass(data.summary.net_shares)}
            />
          </div>
          <ul className="max-h-48 space-y-1 overflow-auto text-xs">
            {data.items.slice(0, 8).map((tx, i) => {
              const isBuy = tx.change > 0;
              return (
                <li
                  key={i}
                  className="flex items-center justify-between border-t border-(--color-border) py-1"
                >
                  <span className="truncate pr-2">{tx.name}</span>
                  <div className="flex shrink-0 items-baseline gap-3 tabular-nums">
                    <span
                      className={`font-medium ${isBuy ? "text-(--color-up)" : "text-(--color-down)"}`}
                    >
                      {isBuy ? "+" : ""}
                      {Math.round(tx.change).toLocaleString()}
                    </span>
                    <span className="text-(--color-text-dim)">
                      @${fmtPrice(tx.transaction_price)}
                    </span>
                    <span className="text-(--color-text-dim)">
                      {tx.transaction_date?.slice(5) ?? "—"}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: string;
}) {
  return (
    <div className="rounded-lg border border-(--color-border) bg-(--color-panel-2) p-2">
      <div className="text-[10px] uppercase tracking-wide text-(--color-text-dim)">
        {label}
      </div>
      <div className={`text-sm font-semibold tabular-nums ${tone}`}>{value}</div>
      {sub && <div className="text-[10px] text-(--color-text-dim)">{sub}</div>}
    </div>
  );
}
