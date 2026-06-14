/** Knockout bracket — rounds R32 → Final laid out left→right as columns.
 * Matchups come from ESPN's knockout fixtures, which exist as placeholders
 * ("Group A 2nd Place", "Round of 32 1 Winner", …) before the group stage
 * ends and fill in with real teams + scores as results land. Clicking a
 * match opens the same live detail modal. */
import { api } from "../api/client";
import type { WcBracket, WcEvent, WcMatchSide } from "../api/types";
import { useCachedFetch } from "../hooks/useCachedFetch";
import { Skeleton } from "./Skeleton";

export function WorldCupBracket({
  refreshNonce,
  onOpenMatch,
}: {
  refreshNonce: number;
  onOpenMatch: (eventId: string) => void;
}) {
  const { data } = useCachedFetch<WcBracket>(
    "worldcup:bracket",
    () => api.get("/worldcup/bracket"),
    { refreshMs: 60_000, staleAfterMs: 45_000 },
  );
  void refreshNonce;

  if (!data) return <Skeleton className="h-80 w-full" />;
  if (data.warning) {
    return <p className="text-sm text-(--color-text-dim)">{data.warning}</p>;
  }
  if (data.rounds.length === 0) {
    return (
      <p className="rounded-md border border-(--color-border) bg-(--color-panel) p-4 text-sm text-(--color-text-dim)">
        The knockout bracket appears once FIFA publishes the fixtures.
      </p>
    );
  }

  const allPlaceholder = data.rounds.every((r) =>
    r.matches.every((m) => !m.home?.logo && !m.away?.logo),
  );

  return (
    <div className="space-y-2">
      {allPlaceholder && (
        <p className="text-[11px] text-(--color-text-dim)">
          Matchups fill in as the group stage finishes (June 27) and the
          Round of 32 begins June 28. Tap any tie for details.
        </p>
      )}
      <div className="flex gap-3 overflow-x-auto pb-3">
        {data.rounds.map((round) => (
          <div key={round.slug} className="flex w-44 shrink-0 flex-col gap-2">
            <div className="sticky top-0 text-[11px] font-semibold uppercase tracking-wide text-(--color-text-dim)">
              {round.label}
            </div>
            {round.matches.map((m) => (
              <BracketMatch
                key={m.id}
                ev={m}
                onClick={() => m.id && onOpenMatch(m.id)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function BracketMatch({ ev, onClick }: { ev: WcEvent; onClick: () => void }) {
  const live = ev.state === "in";
  return (
    <button
      type="button"
      onClick={onClick}
      title="Tap for stats, corners & odds"
      className={`rounded-lg border p-2 text-left transition-colors hover:bg-(--color-panel-2) ${
        live ? "border-(--color-down)/50" : "border-(--color-border)"
      } bg-(--color-panel)`}
    >
      <div className="mb-1 flex items-center justify-between text-[9px] text-(--color-text-dim)">
        <span>{ev.date ? ev.date.slice(5, 10) : ""}</span>
        {live ? (
          <span className="flex items-center gap-1 font-semibold text-(--color-down)">
            <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-(--color-down)" />
            {ev.clock || "LIVE"}
          </span>
        ) : ev.state === "post" ? (
          <span className="text-(--color-text-dim)">FT</span>
        ) : null}
      </div>
      <BracketSide side={ev.home} live={live} />
      <BracketSide side={ev.away} live={live} />
    </button>
  );
}

function BracketSide({
  side,
  live,
}: {
  side: WcMatchSide | null | undefined;
  live: boolean;
}) {
  // Real teams have a flag → show abbr; placeholders show their descriptive
  // name (disambiguates "Round of 32 1 Winner" vs "… 3 Winner").
  const label = side?.logo ? side.abbr || side.name : side?.name || "TBD";
  return (
    <div className="flex items-center justify-between gap-1.5 py-0.5">
      <div className="flex min-w-0 items-center gap-1.5">
        {side?.logo ? (
          <img src={side.logo} alt="" className="h-4 w-4 shrink-0 object-contain" />
        ) : (
          <span className="h-4 w-4 shrink-0" />
        )}
        <span
          className={`line-clamp-2 text-[11px] leading-tight ${
            side?.winner ? "font-semibold" : ""
          }`}
        >
          {label}
        </span>
      </div>
      <span
        className={`shrink-0 text-xs tabular-nums ${
          live ? "font-bold text-(--color-down)" : side?.winner ? "font-semibold" : "text-(--color-text-dim)"
        }`}
      >
        {side?.score == null ? "" : side.score}
      </span>
    </div>
  );
}
