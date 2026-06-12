import { api } from "../api/client";
import { useCachedFetch } from "../hooks/useCachedFetch";

type Clock = {
  is_open: boolean;
  next_open: string | null;
  next_close: string | null;
  timestamp: string | null;
};

type Phase = "open" | "pre" | "after" | "closed";

/** Minutes since midnight in New York, plus weekday, for pre/after-hours
 * classification. Alpaca's clock gives authoritative open/closed (handles
 * holidays); this only refines the closed state into PRE / AFTER / CLOSED. */
function etNow(): { minutes: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { minutes: parseInt(get("hour"), 10) * 60 + parseInt(get("minute"), 10), weekday: wd };
}

function classify(clock: Clock): Phase {
  if (clock.is_open) return "open";
  const { minutes, weekday } = etNow();
  const isWeekday = weekday >= 1 && weekday <= 5;
  if (!isWeekday) return "closed";
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return "pre";
  if (minutes >= 16 * 60 && minutes < 20 * 60) return "after";
  return "closed";
}

const STYLE: Record<Phase, { label: string; cls: string; dot: string }> = {
  open: { label: "OPEN", cls: "text-(--color-up)", dot: "bg-(--color-up)" },
  pre: { label: "PRE", cls: "text-yellow-300", dot: "bg-yellow-400" },
  after: { label: "AFTER", cls: "text-yellow-300", dot: "bg-yellow-400" },
  closed: { label: "CLOSED", cls: "text-(--color-text-dim)", dot: "bg-(--color-text-dim)" },
};

function fmtNext(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

export function MarketStatusBadge() {
  const { data } = useCachedFetch<Clock>("market:clock", () => api.get("/market/clock"), {
    refreshMs: 60_000,
    staleAfterMs: 55_000,
  });
  if (!data) return null;
  const phase = classify(data);
  const s = STYLE[phase];
  const tip = data.is_open
    ? `Market open — closes ${fmtNext(data.next_close) ?? "4:00 PM ET"}`
    : `Market ${phase === "closed" ? "closed" : `${phase}-market`} — opens ${fmtNext(data.next_open) ?? "—"}`;
  return (
    <span
      className={`flex items-center gap-1.5 rounded border border-(--color-border) px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${s.cls}`}
      title={tip}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${s.dot} ${phase === "open" ? "animate-pulse" : ""}`} />
      {s.label}
    </span>
  );
}
