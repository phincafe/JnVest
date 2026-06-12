import { useMemo } from "react";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { api } from "../api/client";
import type { SnapTradeHoldings, SnapTradeOrder } from "../api/types";
import { useCachedFetch } from "../hooks/useCachedFetch";
import { changeClass, fmtPrice } from "../lib/format";
import { Skeleton } from "./Skeleton";
import { UpdatedAgo } from "./UpdatedAgo";

const REFRESH_MS = 5 * 60_000;

type Activity = {
  ticker: string;
  description: string;
  action: string;
  side: "open" | "close";
  qty: number | null;
  price: number | null;
  account: string;
  time: string | null;
  is_option: boolean;
  status: string;
};

function timeAgo(t: string | null): string {
  if (!t) return "—";
  const ms = Date.now() - new Date(t).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function describeOrder(o: SnapTradeOrder): string {
  if (!o.ticker) return "—";
  if (o.is_option && o.strike != null && o.expiration && o.option_type) {
    const t = o.option_type.toLowerCase().startsWith("c") ? "C" : "P";
    return `${o.ticker} $${o.strike}${t} ${o.expiration}`;
  }
  return o.ticker;
}

function isOpenAction(action: string | null): boolean {
  if (!action) return false;
  const a = action.toUpperCase();
  return a.includes("OPEN") || a === "BUY";
}

export function RecentActivity({
  refreshNonce,
  isGuest,
}: {
  refreshNonce: number;
  isGuest: boolean;
}) {
  const { data, fetchedAt } = useCachedFetch<SnapTradeHoldings>(
    "snaptrade:holdings",
    () => api.get("/snaptrade/holdings"),
    { refreshMs: REFRESH_MS, staleAfterMs: 60_000 },
  );
  void refreshNonce;

  const activities: Activity[] = useMemo(() => {
    if (!data?.orders) return [];
    return data.orders
      .filter((o) => o.status === "EXECUTED" || o.status === "FILLED")
      .map((o) => ({
        ticker: o.ticker ?? "—",
        description: describeOrder(o),
        action: o.action ?? "",
        side: isOpenAction(o.action) ? ("open" as const) : ("close" as const),
        qty: o.total_quantity,
        price: o.execution_price,
        account: o.account ?? "",
        time: o.time,
        is_option: o.is_option,
        status: o.status ?? "",
      }))
      .sort((a, b) => (b.time ?? "").localeCompare(a.time ?? ""))
      // Headroom: each column shows up to 10, so keep enough sorted orders
      // around to populate both even when one side dominates.
      .slice(0, 30);
  }, [data]);

  if (!data) return <Skeleton className="h-32" />;
  if (activities.length === 0) {
    return (
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-(--color-text-dim)">
          Recent activity
        </h2>
        <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4 text-sm text-(--color-text-dim)">
          No recent broker orders.
        </div>
      </section>
    );
  }

  const opens = activities.filter((a) => a.side === "open");
  const closes = activities.filter((a) => a.side === "close");

  return (
    <section className="space-y-2">
      <h2 className="flex items-baseline gap-2 text-sm font-medium text-(--color-text-dim)">
        Recent activity
        <UpdatedAgo fetchedAt={fetchedAt} />
      </h2>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ActivityList
          title="Newly added"
          icon={ArrowDownToLine}
          accent="up"
          items={opens.slice(0, 10)}
          isGuest={isGuest}
        />
        <ActivityList
          title="Recently closed"
          icon={ArrowUpFromLine}
          accent="down"
          items={closes.slice(0, 10)}
          isGuest={isGuest}
        />
      </div>
    </section>
  );
}

function ActivityList({
  title,
  icon: Icon,
  accent,
  items,
  isGuest,
}: {
  title: string;
  icon: typeof ArrowDownToLine;
  accent: "up" | "down";
  items: Activity[];
  isGuest: boolean;
}) {
  const accentColor =
    accent === "up" ? "text-(--color-up)" : "text-(--color-down)";
  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-(--color-text-dim)">
        <Icon size={12} className={accentColor} /> {title}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-(--color-text-dim)">Nothing recent.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((a, i) => (
            <li
              key={i}
              className="flex items-baseline justify-between gap-3 text-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {a.description}
                  {a.is_option && (
                    <span className="ml-1 rounded bg-(--color-panel-2) px-1 py-0.5 text-[9px] uppercase text-(--color-text-dim)">
                      Option
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-(--color-text-dim)">
                  {a.action}
                  {!isGuest && a.qty != null && ` · ${a.qty}`}
                  {!isGuest && a.price != null && ` @ $${fmtPrice(a.price)}`}
                  {a.account && ` · ${a.account}`}
                </div>
              </div>
              <span
                className={`shrink-0 text-[11px] tabular-nums ${changeClass(
                  accent === "up" ? 1 : -1,
                )}`}
              >
                {timeAgo(a.time)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
