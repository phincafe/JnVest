/** Match detail modal — live team stats (corners, possession, shots, cards),
 * betting odds, and goal/card events. Polls every 20s while open so a live
 * match stays current. Data: ESPN summary endpoint. */
import { useEffect } from "react";
import { X } from "lucide-react";
import { api } from "../api/client";
import type { WcMatchDetail, WcMatchSide, WcMatchStat } from "../api/types";
import { useCachedFetch } from "../hooks/useCachedFetch";
import { Skeleton } from "./Skeleton";

export function WorldCupMatchModal({
  eventId,
  onClose,
}: {
  eventId: string | null;
  onClose: () => void;
}) {
  const { data } = useCachedFetch<WcMatchDetail>(
    eventId ? `worldcup:match:${eventId}` : null,
    () => api.get(`/worldcup/match/${eventId}`),
    { refreshMs: 20_000, staleAfterMs: 10_000 },
  );

  useEffect(() => {
    if (!eventId) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [eventId, onClose]);

  if (!eventId) return null;
  const live = data?.state === "in";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="my-auto w-full max-w-lg rounded-xl border border-(--color-border) bg-(--color-panel) shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-(--color-border) px-4 py-3">
          <span className="text-xs uppercase tracking-wide text-(--color-text-dim)">
            Match detail
          </span>
          <button
            onClick={onClose}
            className="-m-1 rounded p-1 text-(--color-text-dim) hover:text-(--color-text)"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {!data ? (
          <div className="p-4">
            <Skeleton className="h-64 w-full" />
          </div>
        ) : data.warning ? (
          <p className="p-6 text-sm text-(--color-text-dim)">{data.warning}</p>
        ) : (
          <div className="max-h-[80vh] overflow-y-auto p-4">
            {/* Scoreline */}
            <div className="flex items-center justify-between gap-2">
              <SideHead side={data.home} align="left" />
              <div className="shrink-0 text-center">
                <div className="text-2xl font-bold tabular-nums">
                  {data.home?.score ?? "–"} : {data.away?.score ?? "–"}
                </div>
                <div
                  className={`mt-0.5 flex items-center justify-center gap-1 text-[11px] font-semibold ${
                    live ? "text-(--color-down)" : "text-(--color-text-dim)"
                  }`}
                >
                  {live && (
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-(--color-down)" />
                  )}
                  {data.status_detail ?? ""}
                </div>
              </div>
              <SideHead side={data.away} align="right" />
            </div>
            {(data.venue || data.weather) && (
              <p className="mt-1 flex flex-wrap items-center justify-center gap-x-2 text-center text-[10px] text-(--color-text-dim)">
                {data.venue && <span>{data.venue}</span>}
                {data.weather && (
                  <span className={data.weather.hot ? "text-yellow-300" : ""}>
                    {data.weather.hot ? "🔥 " : "· "}
                    {data.weather.temp_f}°F · {data.weather.desc} · wind{" "}
                    {data.weather.wind_kmh} km/h
                    {data.weather.hot ? " (heat: slower tempo, late fatigue)" : ""}
                  </span>
                )}
              </p>
            )}

            {/* Betting odds */}
            {data.odds?.moneyline && (
              <div className="mt-4 rounded-lg border border-(--color-border) bg-(--color-panel-2)/40 p-3">
                <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wide text-(--color-text-dim)">
                  <span>
                    {data.odds.is_live
                      ? data.odds.delayed
                        ? "In-play odds (moneyline)"
                        : "Live odds (moneyline)"
                      : "Odds · at kickoff (moneyline)"}
                  </span>
                  <span>{data.odds.provider ?? ""}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <OddsCell
                    label={data.home?.abbr ?? "Home"}
                    value={data.odds.moneyline.home}
                    move={data.odds.movement?.home}
                    from={data.odds.kickoff?.home}
                  />
                  <OddsCell
                    label="Draw"
                    value={data.odds.moneyline.draw}
                    move={data.odds.movement?.draw}
                    from={data.odds.kickoff?.draw}
                  />
                  <OddsCell
                    label={data.away?.abbr ?? "Away"}
                    value={data.odds.moneyline.away}
                    move={data.odds.movement?.away}
                    from={data.odds.kickoff?.away}
                  />
                </div>
                {(data.odds.over_under != null || data.odds.details) && (
                  <div className="mt-2 flex justify-center gap-4 text-[11px] text-(--color-text-dim)">
                    {data.odds.over_under != null && (
                      <span>Total goals O/U {data.odds.over_under}</span>
                    )}
                    {data.odds.details && <span>Spread {data.odds.details}</span>}
                  </div>
                )}
                {data.odds.is_live && data.odds.delayed && (
                  <p className="mt-1.5 text-center text-[9px] text-(--color-text-dim)/60">
                    ESPN in-play line — can be delayed several minutes vs
                    sportsbooks
                  </p>
                )}
              </div>
            )}

            {/* Team stats */}
            {data.stats && data.stats.length > 0 && (
              <div className="mt-4 space-y-2.5">
                {data.stats.map((s) => (
                  <StatBar key={s.label} stat={s} />
                ))}
              </div>
            )}

            {/* Key events */}
            {data.events && data.events.length > 0 && (
              <div className="mt-4">
                <div className="mb-1.5 text-[10px] uppercase tracking-wide text-(--color-text-dim)">
                  Key events
                </div>
                <ul className="space-y-1">
                  {data.events.map((e, i) => (
                    <li key={i} className="flex items-baseline gap-2 text-xs">
                      <span className="w-8 shrink-0 tabular-nums text-(--color-text-dim)">
                        {e.clock ?? ""}
                      </span>
                      <span className="shrink-0 font-medium">{e.team_abbr ?? ""}</span>
                      <span className="text-(--color-text-dim)">
                        {e.type}
                        {e.text ? ` — ${e.text}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(!data.stats || data.stats.length === 0) && (
              <p className="mt-4 text-center text-xs text-(--color-text-dim)">
                Live stats appear once the match kicks off.
              </p>
            )}

            <p className="mt-4 text-center text-[10px] text-(--color-text-dim)/70">
              {live ? "Updating every ~20s · " : ""}Data &amp; odds: ESPN /
              DraftKings. Informational only.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function SideHead({
  side,
  align,
}: {
  side: WcMatchSide | null | undefined;
  align: "left" | "right";
}) {
  const pos = side?.group_pos;
  const posText =
    pos && pos.rank != null
      ? `${ordinal(pos.rank)} · ${pos.points ?? 0} pt${pos.points === 1 ? "" : "s"}`
      : null;
  return (
    <div
      className={`flex min-w-0 flex-1 items-center gap-2 ${
        align === "right" ? "flex-row-reverse text-right" : ""
      }`}
    >
      {side?.logo ? (
        <img src={side.logo} alt="" className="h-8 w-8 shrink-0 object-contain" />
      ) : (
        <span className="h-8 w-8 shrink-0" />
      )}
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{side?.name ?? "TBD"}</div>
        {posText && (
          <div
            className="truncate text-[10px] text-(--color-text-dim)"
            title="Current group position"
          >
            {posText}
          </div>
        )}
      </div>
    </div>
  );
}

function ordinal(n: number): string {
  const v = Math.round(n);
  const s = ["th", "st", "nd", "rd"];
  const r = v % 100;
  return v + (s[(r - 20) % 10] || s[r] || s[0]);
}

function OddsCell({
  label,
  value,
  move,
  from,
}: {
  label: string;
  value: string | null;
  move?: "shorten" | "drift" | "flat";
  from?: string | null;
}) {
  // "shorten" = price dropped since kickoff → market rates it MORE likely.
  const arrow = move === "shorten" ? "▼" : move === "drift" ? "▲" : null;
  const arrowCls =
    move === "shorten"
      ? "text-(--color-up)"
      : move === "drift"
        ? "text-(--color-down)"
        : "";
  return (
    <div className="rounded-md bg-(--color-panel) px-2 py-1.5">
      <div className="text-[10px] text-(--color-text-dim)">{label}</div>
      <div className="flex items-center justify-center gap-1 text-sm font-semibold tabular-nums">
        {value ?? "—"}
        {arrow && <span className={`text-[10px] ${arrowCls}`}>{arrow}</span>}
      </div>
      {from && from !== value && (
        <div
          className="text-[9px] text-(--color-text-dim)/60 tabular-nums"
          title="Kickoff price"
        >
          KO {from}
        </div>
      )}
    </div>
  );
}

function StatBar({ stat }: { stat: WcMatchStat }) {
  const h = stat.home_num ?? 0;
  const a = stat.away_num ?? 0;
  const sum = h + a;
  // Possession etc are already a 0-100 split; counts normalize by total.
  const homePct = sum > 0 ? (h / sum) * 100 : 50;
  const homeLeads = h > a;
  const awayLeads = a > h;
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between text-xs tabular-nums">
        <span className={homeLeads ? "font-semibold" : "text-(--color-text-dim)"}>
          {stat.home ?? "0"}
          {stat.suffix}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-(--color-text-dim)">
          {stat.label}
        </span>
        <span className={awayLeads ? "font-semibold" : "text-(--color-text-dim)"}>
          {stat.away ?? "0"}
          {stat.suffix}
        </span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-(--color-panel-2)">
        <div
          className="bg-(--color-accent)"
          style={{ width: `${homePct}%` }}
        />
        <div
          className="bg-(--color-text-dim)/40"
          style={{ width: `${100 - homePct}%` }}
        />
      </div>
    </div>
  );
}
