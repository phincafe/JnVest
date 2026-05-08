import { useMemo } from "react";
import { CalendarClock } from "lucide-react";
import { api } from "../api/client";
import type { CalendarResponse, EarningsEvent, EconEvent } from "../api/types";
import { useCachedFetch } from "../hooks/useCachedFetch";
import { Skeleton } from "./Skeleton";

const REFRESH_MS = 5 * 60_000;

type KeyItem =
  | {
      kind: "econ";
      label: string;
      time: string | null;
      date: string;
      sub: string;
      impact: "high" | "medium" | "low";
    }
  | {
      kind: "earnings";
      label: string;
      time: string | null;
      date: string;
      sub: string;
    };

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowIso(): string {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
}

function fmtTime(t: string | null, date: string): string {
  if (!t || t.length < 16) {
    if (date === todayIso()) return "Today";
    if (date === tomorrowIso()) return "Tomorrow";
    return new Date(date + "T00:00:00").toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }
  const hhmm = t.slice(11, 16);
  const dayPrefix =
    date === todayIso()
      ? ""
      : date === tomorrowIso()
        ? "Tom · "
        : new Date(date + "T00:00:00").toLocaleDateString(undefined, {
            weekday: "short",
          }) + " · ";
  return `${dayPrefix}${hhmm}`;
}

export function KeyEvents({ refreshNonce }: { refreshNonce: number }) {
  const { data } = useCachedFetch<CalendarResponse>(
    "calendar:today",
    () => api.get("/calendar/today"),
    { refreshMs: REFRESH_MS, staleAfterMs: 60_000 },
  );
  void refreshNonce;

  const items: KeyItem[] = useMemo(() => {
    if (!data) return [];
    const out: KeyItem[] = [];
    // High-impact econ events for today + tomorrow
    for (const e of data.econ as EconEvent[]) {
      if (e.impact !== "high") continue;
      const date = e.date ?? e.time?.slice(0, 10) ?? "";
      if (date !== todayIso() && date !== tomorrowIso()) continue;
      out.push({
        kind: "econ",
        label: e.event,
        time: e.time,
        date,
        sub:
          e.estimate != null || e.previous != null
            ? `est ${e.estimate ?? "—"}${e.unit ?? ""} · prev ${e.previous ?? "—"}${e.unit ?? ""}`
            : "",
        impact: e.impact,
      });
    }
    // Watchlist earnings for today + tomorrow
    for (const e of data.earnings as EarningsEvent[]) {
      const date = e.date;
      if (date !== todayIso() && date !== tomorrowIso()) continue;
      out.push({
        kind: "earnings",
        label: `${e.symbol} earnings`,
        time: null,
        date,
        sub: e.hour ? e.hour.toUpperCase() : "",
      });
    }
    // Sort by time within day
    out.sort((a, b) => {
      const da = a.date.localeCompare(b.date);
      if (da !== 0) return da;
      return (a.time ?? "").localeCompare(b.time ?? "");
    });
    return out.slice(0, 6);
  }, [data]);

  if (!data) {
    return <Skeleton className="h-16" />;
  }

  if (items.length === 0) {
    return null; // Don't take morning real-estate when there's nothing notable.
  }

  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 text-sm font-medium text-(--color-text-dim)">
        <CalendarClock size={14} /> Key events — today &amp; tomorrow
      </h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it, i) => (
          <div
            key={i}
            className={`flex items-start justify-between gap-2 rounded-xl border p-3 ${
              it.kind === "earnings"
                ? "border-purple-500/40 bg-purple-500/5"
                : "border-red-500/40 bg-red-500/5"
            }`}
          >
            <div className="min-w-0">
              <div className="text-sm font-medium leading-snug">{it.label}</div>
              {it.sub && (
                <div className="mt-0.5 text-[11px] text-(--color-text-dim) tabular-nums">
                  {it.sub}
                </div>
              )}
            </div>
            <div className="shrink-0 text-right">
              <div className="text-xs font-medium tabular-nums">
                {fmtTime(it.time, it.date)}
              </div>
              <div
                className={`mt-0.5 text-[9px] uppercase tracking-wide ${
                  it.kind === "earnings" ? "text-purple-300" : "text-red-300"
                }`}
              >
                {it.kind === "earnings" ? "Earnings" : "High impact"}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
