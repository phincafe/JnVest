/** Golden Boot dashboard — top goal scorers + assist leaders from ESPN's
 * tournament statistics feed. Stats only: ESPN's free API exposes no
 * outright/golden-boot futures odds, so there are no betting lines here
 * (per-match moneyline lives in the match-detail modal). */
import { api } from "../api/client";
import type { WcScorer, WcScorers } from "../api/types";
import { useCachedFetch } from "../hooks/useCachedFetch";
import { Skeleton } from "./Skeleton";
import { UpdatedAgo } from "./UpdatedAgo";

export function WorldCupScorers({ refreshNonce }: { refreshNonce: number }) {
  const { data, fetchedAt } = useCachedFetch<WcScorers>(
    "worldcup:scorers",
    () => api.get("/worldcup/scorers"),
    { refreshMs: 2 * 60_000, staleAfterMs: 90_000 },
  );
  void refreshNonce;

  if (!data) return <Skeleton className="h-80 w-full" />;
  if (data.warning) {
    return <p className="text-sm text-(--color-text-dim)">{data.warning}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-(--color-text-dim)">
          Live tournament leaders. ESPN's free feed has no golden-boot or
          winner odds — per-match odds are in each match's detail view.
        </p>
        <UpdatedAgo fetchedAt={fetchedAt} />
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <LeaderCard
          title="Golden Boot — top scorers"
          unit="G"
          rows={data.goals}
          emptyHint="No goals recorded yet."
        />
        <LeaderCard
          title="Assist leaders"
          unit="A"
          rows={data.assists}
          emptyHint="No assists recorded yet."
        />
      </div>
    </div>
  );
}

function LeaderCard({
  title,
  unit,
  rows,
  emptyHint,
}: {
  title: string;
  unit: string;
  rows: WcScorer[];
  emptyHint: string;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-(--color-border) bg-(--color-panel)">
      <div className="border-b border-(--color-border) px-3 py-2 text-xs font-semibold">
        {title}
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-(--color-text-dim)">
          {emptyHint}
        </p>
      ) : (
        <ul className="divide-y divide-(--color-border)/50">
          {rows.map((r) => (
            <ScorerRow key={`${r.rank}-${r.name}`} row={r} unit={unit} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ScorerRow({ row, unit }: { row: WcScorer; unit: string }) {
  const leader = row.rank === 1;
  return (
    <li
      className={`flex items-center gap-2 px-3 py-1.5 text-sm ${
        leader ? "bg-yellow-500/5" : ""
      }`}
    >
      <span
        className={`w-5 shrink-0 text-right text-xs tabular-nums ${
          leader ? "font-bold text-yellow-400" : "text-(--color-text-dim)"
        }`}
      >
        {leader ? "🥇" : row.rank}
      </span>
      {row.team_logo ? (
        <img
          src={row.team_logo}
          alt=""
          className="h-5 w-5 shrink-0 object-contain"
        />
      ) : (
        <span className="h-5 w-5 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{row.name ?? "—"}</div>
        <div className="text-[10px] text-(--color-text-dim)">
          {row.team_abbr ?? row.team ?? ""}
          {row.matches != null ? ` · ${row.matches} ${row.matches === 1 ? "match" : "matches"}` : ""}
        </div>
      </div>
      <span className="shrink-0 text-base font-bold tabular-nums">
        {row.value}
        <span className="ml-0.5 text-[10px] font-normal text-(--color-text-dim)">
          {unit}
        </span>
      </span>
    </li>
  );
}
