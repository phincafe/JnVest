import { TrendingDown, TrendingUp } from "lucide-react";
import { api } from "../api/client";
import type { Mover, MoversResponse } from "../api/types";
import { useCachedFetch } from "../hooks/useCachedFetch";
import { changeClass, fmtPct, fmtPrice } from "../lib/format";
import { Skeleton } from "./Skeleton";

export function MarketMovers({ refreshNonce }: { refreshNonce: number }) {
  const { data, isFetching, refetch } = useCachedFetch<MoversResponse>(
    "market:movers",
    () => api.get("/market/movers?limit=5"),
    { refreshMs: 60_000, staleAfterMs: 30_000 },
  );

  // Re-key on refreshNonce so the parent's manual refresh button forces it.
  void refreshNonce;
  void isFetching;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-(--color-text-dim)">Movers</h2>
        <button
          onClick={refetch}
          className="text-xs text-(--color-text-dim) hover:text-(--color-text)"
        >
          refresh
        </button>
      </div>
      {!data ? (
        <Skeleton className="h-32" />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <MoverList title="Top Gainers" icon={TrendingUp} accent="up" rows={data.gainers} />
          <MoverList title="Top Losers" icon={TrendingDown} accent="down" rows={data.losers} />
        </div>
      )}
    </section>
  );
}

function MoverList({
  title,
  icon: Icon,
  accent,
  rows,
}: {
  title: string;
  icon: typeof TrendingUp;
  accent: "up" | "down";
  rows: Mover[];
}) {
  const accentColor =
    accent === "up" ? "text-(--color-up)" : "text-(--color-down)";
  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-3">
      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-(--color-text-dim)">
        <Icon size={12} className={accentColor} /> {title}
      </div>
      <ul className="divide-y divide-(--color-border)">
        {rows.map((r) => (
          <li
            key={r.symbol}
            className="flex items-center justify-between py-1.5 text-sm"
          >
            <span className="font-medium">{r.symbol}</span>
            <div className="flex items-baseline gap-3 tabular-nums">
              <span className="text-(--color-text-dim)">${fmtPrice(r.last)}</span>
              <span className={`font-medium ${changeClass(r.change_pct)}`}>
                {fmtPct(r.change_pct)}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
