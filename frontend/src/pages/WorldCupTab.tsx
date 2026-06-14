/** World Cup 2026 — live scoreboard + group standings from ESPN's public
 * API. "Live" means a 30s poll (no free push feed exists), so goals/clock
 * land within ~30s during a match. Public data: visible to everyone. */
import { api } from "../api/client";
import type {
  WcEvent,
  WcGroup,
  WcScoreboard,
  WcStandings,
  WcStandingRow,
} from "../api/types";
import { useState } from "react";
import { Skeleton } from "../components/Skeleton";
import { UpdatedAgo } from "../components/UpdatedAgo";
import { WorldCupBracket } from "../components/WorldCupBracket";
import { WorldCupMatchModal } from "../components/WorldCupMatchModal";
import { WorldCupScorers } from "../components/WorldCupScorers";
import { useCachedFetch } from "../hooks/useCachedFetch";

type View = "matches" | "bracket" | "scorers";

export default function WorldCupTab({ refreshNonce }: { refreshNonce: number }) {
  const [openMatchId, setOpenMatchId] = useState<string | null>(null);
  const [view, setView] = useState<View>(
    () => (sessionStorage.getItem("jnv:wc-view") as View) || "matches",
  );
  const pick = (v: View) => {
    sessionStorage.setItem("jnv:wc-view", v);
    setView(v);
  };
  const sb = useCachedFetch<WcScoreboard>(
    "worldcup:scoreboard",
    () => api.get("/worldcup/scoreboard"),
    { refreshMs: 30_000, staleAfterMs: 20_000 },
  );
  const st = useCachedFetch<WcStandings>(
    "worldcup:standings",
    () => api.get("/worldcup/standings"),
    { refreshMs: 5 * 60_000, staleAfterMs: 4 * 60_000 },
  );
  void refreshNonce;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-4">
      <WorldCupMatchModal
        eventId={openMatchId}
        onClose={() => setOpenMatchId(null)}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          🏆 World Cup 2026
          {(sb.data?.live_count ?? 0) > 0 && (
            <span className="flex items-center gap-1 rounded bg-(--color-down)/20 px-2 py-0.5 text-xs font-semibold text-(--color-down)">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-(--color-down)" />
              {sb.data!.live_count} LIVE
            </span>
          )}
        </h2>
        <div className="inline-flex rounded-md border border-(--color-border) bg-(--color-panel) p-0.5 text-xs">
          {(["matches", "bracket", "scorers"] as const).map((v) => (
            <button
              key={v}
              onClick={() => pick(v)}
              className={`rounded px-3 py-1 font-medium capitalize ${
                view === v
                  ? "bg-(--color-accent) text-white"
                  : "text-(--color-text-dim) hover:text-(--color-text)"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {view === "bracket" ? (
        <WorldCupBracket
          refreshNonce={refreshNonce}
          onOpenMatch={setOpenMatchId}
        />
      ) : view === "scorers" ? (
        <WorldCupScorers refreshNonce={refreshNonce} />
      ) : (
        <>
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-(--color-text-dim)">
            Today's matches
          </h2>
          <UpdatedAgo fetchedAt={sb.fetchedAt} />
        </div>

        {!sb.data ? (
          <Skeleton className="h-32 w-full" />
        ) : sb.data.warning ? (
          <p className="rounded-md border border-(--color-border) bg-(--color-panel) p-4 text-sm text-(--color-text-dim)">
            {sb.data.warning}
          </p>
        ) : sb.data.events.length === 0 ? (
          <p className="rounded-md border border-(--color-border) bg-(--color-panel) p-4 text-sm text-(--color-text-dim)">
            No matches scheduled today. Group stage runs through 27 June; check
            back on a match day.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sb.data.events.map((e) => (
              <MatchCard
                key={e.id}
                ev={e}
                onOpen={() => e.id && setOpenMatchId(e.id)}
              />
            ))}
          </div>
        )}
        <p className="text-[10px] text-(--color-text-dim)/70">
          Live scores update every ~30s (polled, not instant). Data: ESPN.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-(--color-text-dim)">
          Group standings
        </h2>
        {!st.data ? (
          <Skeleton className="h-64 w-full" />
        ) : st.data.warning ? (
          <p className="text-sm text-(--color-text-dim)">{st.data.warning}</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {st.data.groups.map((g) => (
              <GroupTable key={g.name} group={g} />
            ))}
          </div>
        )}
      </section>
        </>
      )}
    </div>
  );
}

function statusBadge(ev: WcEvent) {
  if (ev.state === "in") {
    return (
      <span className="flex items-center gap-1 rounded bg-(--color-down)/20 px-1.5 py-0.5 text-[10px] font-semibold text-(--color-down)">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-(--color-down)" />
        {ev.clock || "LIVE"}
      </span>
    );
  }
  if (ev.state === "post") {
    return (
      <span className="rounded bg-(--color-panel-2) px-1.5 py-0.5 text-[10px] font-medium text-(--color-text-dim)">
        FT
      </span>
    );
  }
  // Scheduled — show local kickoff time.
  const t = ev.date
    ? new Date(ev.date).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
  return (
    <span className="rounded bg-(--color-panel-2) px-1.5 py-0.5 text-[10px] font-medium text-(--color-text-dim)">
      {t || "Scheduled"}
    </span>
  );
}

function MatchCard({ ev, onOpen }: { ev: WcEvent; onOpen: () => void }) {
  const live = ev.state === "in";
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Tap for live stats, corners & odds"
      className={`w-full rounded-xl border bg-(--color-panel) p-3 text-left transition-colors hover:bg-(--color-panel-2) ${
        live ? "border-(--color-down)/50" : "border-(--color-border)"
      }`}
    >
      <div className="mb-2 flex items-center justify-between text-[10px] text-(--color-text-dim)">
        <span className="truncate">{ev.venue ?? "—"}</span>
        {statusBadge(ev)}
      </div>
      <TeamRow
        name={ev.home?.abbr || ev.home?.name}
        logo={ev.home?.logo}
        score={ev.home?.score}
        live={live}
        winner={ev.state === "post" && !!ev.home?.winner}
      />
      <TeamRow
        name={ev.away?.abbr || ev.away?.name}
        logo={ev.away?.logo}
        score={ev.away?.score}
        live={live}
        winner={ev.state === "post" && !!ev.away?.winner}
      />
    </button>
  );
}

function TeamRow({
  name,
  logo,
  score,
  live,
  winner,
}: {
  name: string | null | undefined;
  logo: string | null | undefined;
  score: number | null | undefined;
  live: boolean;
  winner: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex min-w-0 items-center gap-2">
        {logo ? (
          <img src={logo} alt="" className="h-5 w-5 shrink-0 object-contain" />
        ) : (
          <span className="h-5 w-5 shrink-0" />
        )}
        <span className={`truncate text-sm ${winner ? "font-semibold" : ""}`}>
          {name ?? "TBD"}
        </span>
      </div>
      <span
        className={`tabular-nums ${
          live ? "text-base font-bold text-(--color-down)" : "text-base font-semibold"
        } ${winner ? "" : "text-(--color-text)"}`}
      >
        {score == null ? "–" : score}
      </span>
    </div>
  );
}

function GroupTable({ group }: { group: WcGroup }) {
  return (
    <div className="overflow-hidden rounded-xl border border-(--color-border) bg-(--color-panel)">
      <div className="border-b border-(--color-border) px-3 py-2 text-xs font-semibold">
        {group.name ?? "Group"}
      </div>
      <table className="w-full text-xs">
        <thead className="text-(--color-text-dim)">
          <tr className="border-b border-(--color-border)/60">
            <th className="px-2 py-1 text-left font-normal">Team</th>
            <th className="px-1 py-1 text-right font-normal" title="Played">
              P
            </th>
            <th className="px-1 py-1 text-right font-normal" title="Goal difference">
              GD
            </th>
            <th className="px-2 py-1 text-right font-normal" title="Points">
              Pts
            </th>
          </tr>
        </thead>
        <tbody>
          {group.teams.map((t, i) => (
            <GroupRow key={t.id ?? i} row={t} advancing={i < 2} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupRow({ row, advancing }: { row: WcStandingRow; advancing: boolean }) {
  const gd = row.gd ?? 0;
  return (
    <tr
      className={`border-t border-(--color-border)/40 tabular-nums ${
        advancing ? "bg-(--color-up)/5" : ""
      }`}
      title={
        advancing ? "Top 2 advance to the Round of 32" : undefined
      }
    >
      <td className="px-2 py-1">
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-block h-1 w-1 rounded-full ${
              advancing ? "bg-(--color-up)" : "bg-transparent"
            }`}
          />
          {row.logo && (
            <img src={row.logo} alt="" className="h-4 w-4 object-contain" />
          )}
          <span className="font-medium">{row.abbr ?? row.name}</span>
        </div>
      </td>
      <td className="px-1 py-1 text-right text-(--color-text-dim)">
        {row.played ?? 0}
      </td>
      <td className="px-1 py-1 text-right text-(--color-text-dim)">
        {gd > 0 ? `+${gd}` : gd}
      </td>
      <td className="px-2 py-1 text-right font-semibold">{row.points ?? 0}</td>
    </tr>
  );
}
