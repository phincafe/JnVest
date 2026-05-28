import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Rocket, Sparkles } from "lucide-react";
import { api, ApiError } from "../api/client";
import type {
  CalendarResponse,
  ConfirmedIpo,
  EarningsEvent,
  EconEvent,
  IpoCalendarResponse,
  RumoredIpo,
} from "../api/types";
import { Skeleton } from "./Skeleton";

const REFRESH_MS = 5 * 60_000;

const IMPACT_CLASS: Record<string, string> = {
  high: "bg-red-500/20 text-red-200",
  medium: "bg-yellow-500/20 text-yellow-200",
  low: "bg-(--color-panel-2) text-(--color-text-dim)",
};

const IMPACT_DOT: Record<string, string> = {
  high: "bg-red-500",
  medium: "bg-yellow-500",
  low: "bg-(--color-text-dim)",
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

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
      <IpoSection refreshNonce={refreshNonce} />
    </section>
  );
}

function IpoSection({ refreshNonce }: { refreshNonce: number }) {
  const [data, setData] = useState<IpoCalendarResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api
        .get<IpoCalendarResponse>("/calendar/ipos")
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
    // Calendar changes once per day; refresh hourly along with the rest.
    const id = setInterval(load, 60 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [refreshNonce]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Rocket size={14} className="text-(--color-accent)" />
        <h3 className="text-xs uppercase tracking-wide text-(--color-text-dim)">
          Upcoming IPOs
        </h3>
      </div>
      {err && (
        <div className="rounded-md border border-(--color-down)/40 bg-(--color-panel) p-2 text-xs text-(--color-down)">
          {err}
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <RumoredIpoCard data={data} />
        <ConfirmedIpoCard data={data} />
      </div>
    </div>
  );
}

function RumoredIpoCard({ data }: { data: IpoCalendarResponse | null }) {
  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
      <div className="mb-3 flex items-center gap-1.5">
        <Sparkles size={12} className="text-(--color-accent)" />
        <h3 className="text-xs uppercase tracking-wide text-(--color-text-dim)">
          Rumored mega-IPOs to watch
        </h3>
      </div>
      {!data ? (
        <Skeleton className="h-40 w-full" />
      ) : data.rumored.length === 0 ? (
        <p className="text-sm text-(--color-text-dim)">No rumored IPOs tracked.</p>
      ) : (
        <ul className="space-y-3">
          {data.rumored.map((ipo) => (
            <RumoredIpoRow key={ipo.name} ipo={ipo} />
          ))}
        </ul>
      )}
      <p className="mt-3 text-[10px] italic text-(--color-text-dim)/70">
        Speculative / no S-1 filed unless noted. Related tickers historically
        move on IPO-narrative shifts — no recommendation implied.
      </p>
    </div>
  );
}

function RumoredIpoRow({ ipo }: { ipo: RumoredIpo }) {
  const [open, setOpen] = useState(ipo.name === "SpaceX");
  return (
    <li className="rounded-md border border-(--color-border)/60 bg-(--color-panel-2)/40 p-2.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start justify-between gap-3 text-left"
        aria-expanded={open}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {open ? (
              <ChevronDown size={12} className="shrink-0 text-(--color-text-dim)" />
            ) : (
              <ChevronRight size={12} className="shrink-0 text-(--color-text-dim)" />
            )}
            <span className="truncate text-sm font-medium">{ipo.name}</span>
            <span className="shrink-0 rounded bg-(--color-panel) px-1.5 py-0.5 text-[10px] uppercase text-(--color-text-dim)">
              {ipo.sector}
            </span>
          </div>
          <div className="ml-4 mt-1 text-[11px] text-(--color-text-dim) tabular-nums">
            <span className="text-(--color-text)">{ipo.est_valuation_usd}</span>
            {" · "}
            {ipo.est_timing}
          </div>
        </div>
      </button>
      {open && (
        <div className="ml-4 mt-2 space-y-2 text-xs">
          <p className="text-(--color-text-dim)">{ipo.why_it_matters}</p>
          {ipo.related_tickers.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[10px] uppercase text-(--color-text-dim)/70">
                Related:
              </span>
              {ipo.related_tickers.map((t) => (
                <span
                  key={t}
                  className="rounded bg-(--color-panel) px-1.5 py-0.5 text-[10px] font-medium text-(--color-text)"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function ConfirmedIpoCard({ data }: { data: IpoCalendarResponse | null }) {
  const groups = useMemo(() => {
    if (!data) return [] as Array<[string, ConfirmedIpo[]]>;
    const map: Record<string, ConfirmedIpo[]> = {};
    for (const ipo of data.confirmed) {
      const k = ipo.date ?? "";
      (map[k] ??= []).push(ipo);
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [data]);

  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
      <h3 className="mb-3 text-xs uppercase tracking-wide text-(--color-text-dim)">
        Confirmed (next 30 days)
      </h3>
      {!data ? (
        <Skeleton className="h-40 w-full" />
      ) : data.confirmed_warning ? (
        <p className="text-sm text-(--color-text-dim)">
          {data.confirmed_warning}
        </p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-(--color-text-dim)">
          No confirmed IPOs on Finnhub's calendar in the next 30 days.
        </p>
      ) : (
        <ul className="divide-y divide-(--color-border)/60">
          {groups.map(([day, ipos]) => (
            <DayGroup
              key={day}
              day={day}
              count={ipos.length}
              defaultOpen={day === todayIso() || ipos.length <= 4}
            >
              <ul className="space-y-1.5 pb-2">
                {ipos.map((ipo, i) => (
                  <li
                    key={i}
                    className="flex items-start justify-between gap-3 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {ipo.symbol && (
                          <span className="font-medium tabular-nums">
                            {ipo.symbol}
                          </span>
                        )}
                        <span className="truncate text-(--color-text-dim)">
                          {ipo.name ?? "—"}
                        </span>
                      </div>
                      <div className="text-[11px] text-(--color-text-dim) tabular-nums">
                        {ipo.exchange ?? "—"}
                        {ipo.price_range ? ` · ${ipo.price_range}` : ""}
                        {ipo.total_value_usd
                          ? ` · ${formatUsd(ipo.total_value_usd)}`
                          : ""}
                      </div>
                    </div>
                    {ipo.status && (
                      <span className="shrink-0 rounded bg-(--color-panel-2) px-1.5 py-0.5 text-[10px] uppercase text-(--color-text-dim)">
                        {ipo.status}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </DayGroup>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

function dayLabel(iso: string | undefined | null): string {
  if (!iso) return "—";
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  if (iso === todayIso) return "Today";
  const tomorrow = new Date(today.getTime() + 86_400_000)
    .toISOString()
    .slice(0, 10);
  if (iso === tomorrow) return "Tomorrow";
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function EconCard({ data }: { data: CalendarResponse | null }) {
  const groups = useMemo(() => {
    if (!data) return [] as Array<[string, EconEvent[]]>;
    const map: Record<string, EconEvent[]> = {};
    for (const e of data.econ) {
      const k = e.date ?? e.time?.slice(0, 10) ?? "";
      (map[k] ??= []).push(e);
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [data]);

  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
      <h3 className="mb-3 text-xs uppercase tracking-wide text-(--color-text-dim)">
        US economic releases (next 10d, high + medium impact)
      </h3>
      {!data ? (
        <Skeleton className="h-24 w-full" />
      ) : data.econ_warning ? (
        <p className="text-sm text-(--color-text-dim)">{data.econ_warning}</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-(--color-text-dim)">
          No high/medium-impact US events in the next 10 days.
        </p>
      ) : (
        <ul className="divide-y divide-(--color-border)/60">
          {groups.map(([day, events]) => (
            <DayGroup
              key={day}
              day={day}
              count={events.length}
              highCount={events.filter((e) => e.impact === "high").length}
              defaultOpen={day === todayIso()}
            >
              <ul className="space-y-1.5 pb-2">
                {events.map((e, i) => (
                  <li
                    key={i}
                    className="flex items-start justify-between gap-3 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{e.event}</div>
                      <div className="text-[11px] text-(--color-text-dim) tabular-nums">
                        {e.time?.slice(11, 16)} · est {e.estimate ?? "—"}
                        {e.unit ?? ""} · prev {e.previous ?? "—"}
                        {e.unit ?? ""}
                        {e.actual != null && (
                          <>
                            {" · "}
                            <span className="text-(--color-text)">
                              actual {e.actual}
                              {e.unit ?? ""}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase ${IMPACT_CLASS[e.impact] ?? ""}`}
                    >
                      {e.impact}
                    </span>
                  </li>
                ))}
              </ul>
            </DayGroup>
          ))}
        </ul>
      )}
    </div>
  );
}

function EarningsCard({ data }: { data: CalendarResponse | null }) {
  const groups = useMemo(() => {
    if (!data) return [] as Array<[string, EarningsEvent[]]>;
    const map: Record<string, EarningsEvent[]> = {};
    for (const e of data.earnings) {
      const k = e.date ?? "";
      (map[k] ??= []).push(e);
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [data]);

  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
      <h3 className="mb-3 text-xs uppercase tracking-wide text-(--color-text-dim)">
        Watchlist earnings (next 20d)
      </h3>
      {!data ? (
        <Skeleton className="h-24 w-full" />
      ) : data.earnings_warning ? (
        <p className="text-sm text-(--color-text-dim)">{data.earnings_warning}</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-(--color-text-dim)">
          No watchlist tickers report earnings in the next 20 days.
        </p>
      ) : (
        <ul className="divide-y divide-(--color-border)/60">
          {groups.map(([day, events]) => (
            <DayGroup
              key={day}
              day={day}
              count={events.length}
              defaultOpen={day === todayIso()}
            >
              <ul className="space-y-1 pb-2">
                {events.map((e, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{e.symbol}</span>
                      {e.hour && (
                        <span className="rounded bg-(--color-panel-2) px-1.5 py-0.5 text-[9px] uppercase text-(--color-text-dim)">
                          {e.hour}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-(--color-text-dim) tabular-nums">
                      {e.eps_estimate != null
                        ? `EPS est ${e.eps_estimate}`
                        : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </DayGroup>
          ))}
        </ul>
      )}
    </div>
  );
}

function DayGroup({
  day,
  count,
  highCount,
  defaultOpen,
  children,
}: {
  day: string;
  count: number;
  highCount?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const isToday = day === todayIso();
  return (
    <li className="py-1.5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left hover:bg-(--color-panel-2)"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          {open ? (
            <ChevronDown size={12} className="text-(--color-text-dim)" />
          ) : (
            <ChevronRight size={12} className="text-(--color-text-dim)" />
          )}
          <span
            className={`text-[11px] font-semibold uppercase tracking-wide ${
              isToday ? "text-(--color-accent)" : "text-(--color-text-dim)"
            }`}
          >
            {dayLabel(day)}
          </span>
        </span>
        <span className="flex items-center gap-2 text-[11px] text-(--color-text-dim)">
          {highCount ? (
            <span className="flex items-center gap-1">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${IMPACT_DOT.high}`} />
              {highCount}
            </span>
          ) : null}
          <span className="tabular-nums">
            {count} {count === 1 ? "event" : "events"}
          </span>
        </span>
      </button>
      {open && <div className="mt-2 pl-5">{children}</div>}
    </li>
  );
}
