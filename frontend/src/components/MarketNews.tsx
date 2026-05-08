import { ExternalLink } from "lucide-react";
import { api } from "../api/client";
import type { MarketNewsResponse } from "../api/types";
import { useCachedFetch } from "../hooks/useCachedFetch";
import { Skeleton } from "./Skeleton";

function fmtTime(ts: number): string {
  const d = new Date(ts * 1000);
  const now = Date.now();
  const diff = (now - d.getTime()) / 1000;
  if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))}m ago`;
  if (diff < 86_400) return `${Math.round(diff / 3600)}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function MarketNews({ refreshNonce }: { refreshNonce: number }) {
  const { data, isFetching } = useCachedFetch<MarketNewsResponse>(
    "market:news",
    () => api.get("/market/news?limit=15"),
    { refreshMs: 5 * 60_000, staleAfterMs: 60_000 },
  );
  void refreshNonce;
  void isFetching;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-(--color-text-dim)">
        Market news
      </h2>
      {!data ? (
        <Skeleton className="h-48" />
      ) : data.warning ? (
        <p className="rounded-md border border-(--color-border) bg-(--color-panel) p-3 text-xs text-(--color-text-dim)">
          {data.warning}
        </p>
      ) : data.items.length === 0 ? (
        <p className="rounded-md border border-(--color-border) bg-(--color-panel) p-3 text-xs text-(--color-text-dim)">
          No headlines.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {data.items.map((it, i) => (
            <li
              key={i}
              className="rounded-xl border border-(--color-border) bg-(--color-panel) p-3 text-sm hover:border-(--color-text-dim)"
            >
              <a
                href={it.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block"
              >
                <div className="flex items-start gap-3">
                  {it.image && (
                    <img
                      src={it.image}
                      alt=""
                      loading="lazy"
                      className="h-14 w-14 shrink-0 rounded object-cover opacity-90"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-medium leading-snug text-(--color-text)">
                      {it.headline}
                      <ExternalLink size={11} className="ml-1 inline opacity-50" />
                    </div>
                    <div className="mt-1 text-[11px] text-(--color-text-dim)">
                      {it.source} · {fmtTime(it.ts)}
                    </div>
                  </div>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
