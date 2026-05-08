import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { CalendarResponse } from "../api/types";
import { Skeleton } from "./Skeleton";

const REFRESH_MS = 5 * 60_000;

const IMPACT_CLASS: Record<string, string> = {
  high: "bg-red-500/20 text-red-200",
  medium: "bg-yellow-500/20 text-yellow-200",
  low: "bg-(--color-panel-2) text-(--color-text-dim)",
};

export function Calendar({ refreshNonce }: { refreshNonce: number }) {
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api
        .get<CalendarResponse>("/calendar/today")
        .then((d) => {
          if (!cancelled) {
            setData(d);
            setErr(null);
          }
        })
        .catch((e) => {
          if (!cancelled)
            setErr(e instanceof ApiError ? e.detail : (e as Error).message);
        });
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [refreshNonce]);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-(--color-text-dim)">Calendar</h2>
      {err && (
        <div className="rounded-md border border-(--color-down)/40 bg-(--color-panel) p-2 text-xs text-(--color-down)">
          {err}
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <EconCard data={data} />
        <EarningsCard data={data} />
      </div>
    </section>
  );
}

function EconCard({ data }: { data: CalendarResponse | null }) {
  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
      <h3 className="mb-3 text-xs uppercase tracking-wide text-(--color-text-dim)">
        Today's US economic releases
      </h3>
      {!data ? (
        <Skeleton className="h-24 w-full" />
      ) : data.econ_warning ? (
        <p className="text-sm text-(--color-text-dim)">{data.econ_warning}</p>
      ) : data.econ.length === 0 ? (
        <p className="text-sm text-(--color-text-dim)">Nothing scheduled today.</p>
      ) : (
        <ul className="space-y-2">
          {data.econ.map((e, i) => (
            <li key={i} className="flex items-start justify-between gap-3 text-sm">
              <div>
                <div className="font-medium">{e.event}</div>
                <div className="text-xs text-(--color-text-dim) tabular-nums">
                  {e.time?.slice(11, 16)} · est {e.estimate ?? "—"}
                  {e.unit ? e.unit : ""} · prev {e.previous ?? "—"}
                  {e.unit ? e.unit : ""}
                  {e.actual != null && (
                    <>
                      {" · "}
                      <span className="text-(--color-text)">
                        actual {e.actual}
                        {e.unit ? e.unit : ""}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${IMPACT_CLASS[e.impact] ?? ""}`}
              >
                {e.impact}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EarningsCard({ data }: { data: CalendarResponse | null }) {
  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
      <h3 className="mb-3 text-xs uppercase tracking-wide text-(--color-text-dim)">
        Watchlist earnings (next 7d)
      </h3>
      {!data ? (
        <Skeleton className="h-24 w-full" />
      ) : data.earnings_warning ? (
        <p className="text-sm text-(--color-text-dim)">{data.earnings_warning}</p>
      ) : data.earnings.length === 0 ? (
        <p className="text-sm text-(--color-text-dim)">No watchlist earnings this week.</p>
      ) : (
        <ul className="space-y-2">
          {data.earnings.map((e, i) => (
            <li key={i} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium">{e.symbol}</span>
                <span className="text-xs text-(--color-text-dim)">
                  {e.date}
                  {e.hour ? ` · ${e.hour.toUpperCase()}` : ""}
                </span>
              </div>
              <span className="text-xs text-(--color-text-dim) tabular-nums">
                {e.eps_estimate != null ? `EPS est ${e.eps_estimate}` : "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
